#!/usr/bin/env python3
"""Live smoke test for one model-owned ModelScope computer/desktop Studio.

The script uses the same authenticated Gradio RPCs as the app. It checks the
persistent home, real Bash execution, background jobs, and (unless --no-gui is
set) an actual X11 desktop frame plus Bash access while that desktop is running.
It never downloads, replaces, or modifies model/media weights.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import time
import uuid
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


def fail(message: str) -> None:
    raise RuntimeError(message)


def open_with_retry(
    url: str,
    headers: dict[str, str],
    data: bytes | None,
    method: str,
    timeout: int,
    label: str,
):
    """Retry transient ModelScope gateway throttling and edge errors."""
    retryable = {403, 429, 500, 502, 503, 504}
    for attempt in range(6):
        request = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            return urllib.request.urlopen(request, timeout=timeout)
        except urllib.error.HTTPError as exc:
            if exc.code not in retryable or attempt == 5:
                raise
            retry_after = exc.headers.get("Retry-After") if exc.headers else None
            try:
                delay = max(1.0, min(45.0, float(retry_after))) if retry_after else min(30.0, 6.0 * (attempt + 1))
            except (TypeError, ValueError):
                delay = min(30.0, 6.0 * (attempt + 1))
            print(
                f"ModelScope gateway HTTP {exc.code} for {label}; retry {attempt + 1}/5 in {delay:.0f}s",
                file=sys.stderr,
                flush=True,
            )
            exc.close()
            time.sleep(delay)
    raise RuntimeError(f"{label}: retry loop exited unexpectedly")


def request_json(
    method: str,
    url: str,
    token: str,
    body: dict[str, Any] | None = None,
    timeout: int = 35,
) -> dict[str, Any]:
    data = json.dumps(body, separators=(",", ":")).encode() if body is not None else None
    headers = {
        "Authorization": "Bearer " + token,
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": "Ttbik-ModelScope-Computer-Smoke/1.0",
    }
    try:
        with open_with_retry(url, headers, data, method, timeout, url.rsplit("/", 1)[-1]) as response:
            raw = response.read(3_000_000)
            if response.status < 200 or response.status >= 300:
                fail(f"{method} {url.rsplit('/', 1)[-1]} returned HTTP {response.status}")
    except urllib.error.HTTPError as exc:
        # Do not print response bodies: private Studio gateways may echo inputs.
        fail(f"{method} {url.rsplit('/', 1)[-1]} returned HTTP {exc.code}")
    except (urllib.error.URLError, TimeoutError) as exc:
        fail(f"{method} {url.rsplit('/', 1)[-1]} could not reach the Studio ({type(exc).__name__})")
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        fail("Studio returned an unreadable JSON response")
    if not isinstance(value, dict):
        fail("Studio returned a non-object JSON response")
    return value


def unwrap_result(frame: str) -> dict[str, Any] | None:
    event = ""
    data_lines: list[str] = []
    for line in frame.splitlines():
        if line.startswith("event:"):
            event = line.partition(":")[2].strip()
        elif line.startswith("data:"):
            data_lines.append(line.partition(":")[2].strip())
    if event == "error":
        fail("Studio RPC returned an error event")
    if event != "complete" or not data_lines:
        return None
    raw = "\n".join(data_lines)
    try:
        value: Any = json.loads(raw)
        if isinstance(value, list):
            value = value[0] if value else None
        if isinstance(value, str):
            value = json.loads(value)
    except (ValueError, TypeError):
        fail("Studio RPC completed without a valid result: " + raw[:200].replace("\n", " "))
    if not isinstance(value, dict):
        fail("Studio RPC result was not an object: " + raw[:200].replace("\n", " "))
    return value


def gradio_call(
    api: str,
    name: str,
    payload: dict[str, Any],
    token: str,
    timeout: int = 120,
) -> dict[str, Any]:
    # Shell and desktop calls use the same base64 envelope as computerBox.ts.
    wire = "b64:" + base64.b64encode(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ).decode("ascii")
    started = request_json(
        "POST",
        f"{api}/gradio_api/call/{name}",
        token,
        {"data": [wire]},
        timeout=35,
    )
    event_id = started.get("event_id")
    if not isinstance(event_id, str) or not event_id:
        fail(f"{name}: Studio did not return an event id")
    url = f"{api}/gradio_api/call/{name}/{urllib.parse.quote(event_id, safe='')}"
    # Gradio uses SSE; read until the terminal complete/error event.
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": "Bearer " + token,
            "Accept": "text/event-stream",
            "User-Agent": "Ttbik-ModelScope-Computer-Smoke/1.0",
        },
        method="GET",
    )
    try:
        sse_headers = {
            "Authorization": "Bearer " + token,
            "Accept": "text/event-stream",
            "User-Agent": "Ttbik-ModelScope-Computer-Smoke/1.0",
        }
        with open_with_retry(url, sse_headers, None, "GET", timeout, name + " result") as response:
            chunks: list[str] = []
            size = 0
            while True:
                part = response.readline()
                if not part:
                    break
                text = part.decode("utf-8", "replace")
                chunks.append(text)
                size += len(part)
                joined = "".join(chunks)
                if "\nevent: complete\n" in "\n" + joined or "\nevent: error\n" in "\n" + joined:
                    result = unwrap_result(joined)
                    if result is not None:
                        return result
                if size > 4_000_000:
                    fail(f"{name}: result exceeded the smoke-test size limit")
    except urllib.error.HTTPError as exc:
        fail(f"{name} result returned HTTP {exc.code}")
    except (urllib.error.URLError, TimeoutError) as exc:
        fail(f"{name} result timed out or could not reach the Studio ({type(exc).__name__})")
    result = unwrap_result("".join(chunks))
    if result is not None:
        return result
    fail(f"{name}: Studio stream ended without a complete result")


def live_stream(api: str, token: str, payload: dict[str, Any], timeout: int = 40) -> list[tuple[float, dict[str, Any]]]:
    """Reads the Studio's `live` generator: every intermediate event with its arrival time (seconds since the request)."""
    wire = "b64:" + base64.b64encode(json.dumps(payload, separators=(",", ":")).encode("utf-8")).decode("ascii")
    t0 = time.time()
    started = request_json("POST", f"{api}/gradio_api/call/live", token, {"data": [wire]}, timeout=35)
    event_id = started.get("event_id")
    if not isinstance(event_id, str) or not event_id:
        fail("live: Studio did not return an event id")
    url = f"{api}/gradio_api/call/live/{urllib.parse.quote(event_id, safe='')}"
    headers = {"Authorization": "Bearer " + token, "Accept": "text/event-stream", "User-Agent": "Ttbik-ModelScope-Computer-Smoke/1.0"}
    events: list[tuple[float, dict[str, Any]]] = []
    with open_with_retry(url, headers, None, "GET", timeout, "live stream") as response:
        while True:
            line = response.readline()
            if not line:
                break
            text = line.decode("utf-8", "replace").strip()
            if not text.startswith("data:"):
                continue
            try:
                value: Any = json.loads(text[5:].strip())
                if isinstance(value, list):
                    value = value[0] if value else None
                if isinstance(value, str):
                    value = json.loads(value)
            except (ValueError, TypeError):
                continue
            if isinstance(value, dict):
                events.append((round(time.time() - t0, 2), value))
                if value.get("end"):
                    break
    return events


def check_live(api: str, token: str, session: str, marker: str, frames_dir: str = "") -> dict[str, Any]:
    """Live view numbers on a RUNNING desktop: one-frame poll latency, the streamed frame rate, live terminal output while a command runs,
    and pointer accuracy (a click lands on the exact pixel). Frames are saved to frames_dir as evidence (a CI test desktop, no user data)."""
    out: dict[str, Any] = {}
    polls = []
    for _ in range(4):
        t = time.time()
        f = desktop_call(api, token, {"action": "frame", "session": session, "quality": 50, "scale": 0.75}, timeout=60)
        assert_ok(f, "live poll frame")
        polls.append(round(time.time() - t, 2))
    out["poll_frame_s"] = polls
    out["poll_frame_bytes"] = len(str(f.get("screenshot_b64") or "")) * 3 // 4
    # something visibly changing on screen + a command printing lines while the stream is read
    desktop_call(api, token, {"action": "launch", "session": session, "app": "terminal"}, timeout=40)
    import threading
    runner = threading.Thread(target=lambda: box_call(api, token, {"action": "run", "session": session, "timeout": 25,
                                                                    "command": f"for i in 1 2 3 4 5 6; do echo LIVE_{marker}_$i; sleep 1.5; done"}, timeout=60), daemon=True)
    stream_payload = {"session": session, "seconds": 14, "interval": 0.4, "quality": 50, "scale": 0.75}
    runner.start()
    events = live_stream(api, token, stream_payload, timeout=60)
    runner.join(40)
    frames = [(t, e) for t, e in events if e.get("screenshot_b64")]
    gaps = [round(b[0] - a[0], 2) for a, b in zip(frames, frames[1:])]
    live_out = " ".join(str(a.get("output") or "") for _, e in events for a in (e.get("activity") or []) if a.get("state") == "start")
    out.update({"stream_events": len(events), "stream_frames": len(frames), "stream_first_s": events[0][0] if events else None,
                "stream_frame_gap_avg_s": round(sum(gaps) / len(gaps), 2) if gaps else None, "stream_frame_gap_max_s": max(gaps) if gaps else None,
                "live_terminal_seen_while_running": f"LIVE_{marker}_1" in live_out,
                "activity_actions": sorted({a.get("action") for _, e in events for a in (e.get("activity") or [])})})
    if frames_dir:
        os.makedirs(frames_dir, exist_ok=True)
        for i, (t, e) in enumerate(frames[:40]):
            with open(os.path.join(frames_dir, f"frame-{i:03d}-{t:06.2f}s.jpg"), "wb") as fh:
                fh.write(base64.b64decode(e["screenshot_b64"]))
    # pointer accuracy: click / drag land on the exact screen pixel
    hits = []
    for x, y in ((321, 123), (1000, 700), (12, 830)):
        desktop_call(api, token, {"action": "move", "session": session, "x": x, "y": y}, timeout=40)
        p = desktop_call(api, token, {"action": "pointer", "session": session}, timeout=40)
        hits.append([x, y, p.get("x"), p.get("y")])
    out["pointer_hits"] = hits
    out["pointer_exact"] = all(h[0] == h[2] and h[1] == h[3] for h in hits)
    return out


def box_call(api: str, token: str, payload: dict[str, Any], timeout: int = 120) -> dict[str, Any]:
    return gradio_call(api, "box_do", payload, token, timeout)


def desktop_call(api: str, token: str, payload: dict[str, Any], timeout: int = 55) -> dict[str, Any]:
    return gradio_call(api, "desktop_do", payload, token, timeout)


def assert_ok(result: dict[str, Any], label: str) -> None:
    if result.get("ok") is not True:
        message = str(result.get("error") or result.get("reason") or "operation refused")
        fail(f"{label}: {message[:240]}")


def check_shell(api: str, token: str, session: str, marker: str) -> None:
    status = box_call(api, token, {"action": "status", "session": session})
    assert_ok(status, "computer status")
    if status.get("persistent") is not True:
        fail("computer home is not backed by the persistent Studio workspace")
    if status.get("tools", {}).get("python3") is not True:
        fail("python3 is not installed in the selected Studio computer")
    capacity = status.get("capacity") or {}
    limits = status.get("limits") or {}
    available_mb = capacity.get("available_mb")
    minimum_mb = limits.get("minimum_available_mb")
    if not isinstance(available_mb, (int, float)) or available_mb < 2048:
        fail(f"terminal requires at least 2048 MB available; reported {available_mb} MB")
    if not isinstance(minimum_mb, (int, float)) or minimum_mb < 2048:
        fail(f"terminal admission limit is too low or missing: {minimum_mb} MB")
    if limits.get("global_jobs") != 6:
        fail(f"Studio global execution limit must match the owner-approved six isolated sessions; reported {limits.get('global_jobs')}")
    print(f"Computer capacity: {available_mb} MB available; terminal floor {minimum_mb} MB; global jobs={limits.get('global_jobs')}", flush=True)
    print("Network egress isolation:", status.get("egress", "not reported"), flush=True)
    if status.get("egress", "").startswith(("not available", "partly blocked")):
        # The computer can still execute commands, but never claim network egress is protected.
        print("WARNING: Studio reports an incomplete private-network egress block", flush=True)

    path = f".ci-computer-smoke-{marker}.txt"
    written = box_call(api, token, {"action": "write", "session": session, "path": path, "content": marker + "\n"}, timeout=45)
    assert_ok(written, "computer file write")
    ran = box_call(
        api,
        token,
        {
            "action": "run",
            "session": session,
            "cwd": ".",
            "timeout": 20,
            "command": f"printf 'BASH_OK:{marker}\\n'; printf 'UID='; id -u; cat '{path}'",
        },
        timeout=40,
    )
    assert_ok(ran, "computer Bash command")
    if ran.get("exit_code") != 0 or f"BASH_OK:{marker}" not in str(ran.get("output", "")) or marker not in str(ran.get("output", "")):
        fail("Bash command did not execute or could not read its own persistent file")
    output = str(ran.get("output", ""))
    uid_line = next((line for line in output.splitlines() if line.startswith("UID=")), "")
    if uid_line == "UID=0":
        fail("computer shell unexpectedly ran as root")

    read = box_call(api, token, {"action": "read", "session": session, "path": path}, timeout=35)
    assert_ok(read, "computer file read")
    if marker not in str(read.get("text", "")):
        fail("the computer did not preserve the file between RPC calls")

    job = box_call(
        api,
        token,
        {
            "action": "job_start",
            "session": session,
            "name": "ci-computer-smoke",
            "command": f"echo JOB_STARTED:{marker}; sleep 1; echo JOB_FINISHED:{marker}",
        },
        timeout=40,
    )
    assert_ok(job, "computer background job start")
    job_id = job.get("id")
    if not isinstance(job_id, str) or not job_id:
        fail("computer background job did not return an id")
    deadline = time.monotonic() + 18
    last_log: dict[str, Any] = {}
    while time.monotonic() < deadline:
        last_log = box_call(
            api,
            token,
            {"action": "job_log", "session": session, "id": job_id, "tail": 30},
            timeout=35,
        )
        assert_ok(last_log, "computer background job log")
        text = str(last_log.get("output", ""))
        if f"JOB_FINISHED:{marker}" in text and last_log.get("running") is False:
            break
        time.sleep(0.4)
    else:
        box_call(api, token, {"action": "job_stop", "session": session, "id": job_id}, timeout=35)
        fail("computer background job did not finish within 18 seconds")
    if last_log.get("exit_code") != 0:
        fail("computer background job exited with a non-zero code")

    # Cleanup is scoped to the unique smoke-test filename and job id.
    cleanup = box_call(
        api,
        token,
        {"action": "run", "session": session, "timeout": 10, "command": f"rm -f '{path}'"},
        timeout=30,
    )
    assert_ok(cleanup, "computer smoke cleanup")


def check_banks(api: str, token: str, session: str, marker: str) -> None:
    """Exercise the deployed bank catalog, object store, search index and restore path."""
    bank = "ci-" + marker
    path = f".ci-bank-{marker}.md"
    content = f"# BANK_SMOKE_{marker}\nهذا ملف اختبار لبنك الحاسوب ويجب أن يظهر عند البحث عن {marker}.\n"
    write = box_call(api, token, {"action": "write", "session": session, "path": path, "content": content}, timeout=45)
    assert_ok(write, "bank source file write")
    created = box_call(api, token, {"action": "bank", "bank_action": "create", "session": session,
                                    "bank": bank, "category": "documents", "description": "temporary deployment smoke bank"}, timeout=45)
    assert_ok(created, "bank create")
    try:
        stored = box_call(api, token, {"action": "bank", "bank_action": "put", "session": session,
                                       "bank": bank, "source_path": path, "kind": "document"}, timeout=60)
        assert_ok(stored, "bank put")
        item_id = str(stored.get("item_id") or "")
        if not item_id or int(stored.get("text_indexed_chars") or 0) < 10:
            fail("bank put did not return an item id and indexed text")
        found = box_call(api, token, {"action": "bank", "bank_action": "search", "session": session,
                                      "bank": bank, "query": marker, "limit": 5}, timeout=45)
        assert_ok(found, "bank search")
        results = found.get("results") or []
        if not any(item.get("item_id") == item_id for item in results):
            fail("bank search did not retrieve the item just stored")
        restored = box_call(api, token, {"action": "bank", "bank_action": "get", "session": session,
                                         "bank": bank, "item_id": item_id}, timeout=45)
        assert_ok(restored, "bank get")
        if marker not in str(restored.get("text") or ""):
            fail("bank get did not restore searchable document text")
        stats = box_call(api, token, {"action": "bank", "bank_action": "stats", "session": session}, timeout=45)
        assert_ok(stats, "bank stats")
        if int(stats.get("banks") or 0) < 1 or int(stats.get("items") or 0) < 1:
            fail("bank stats did not report the smoke-test bank and item")
    finally:
        try:
            box_call(api, token, {"action": "bank", "bank_action": "drop", "session": session,
                                  "bank": bank, "confirm": True}, timeout=45)
        finally:
            box_call(api, token, {"action": "run", "session": session, "timeout": 10,
                                  "command": f"rm -f '{path}'"}, timeout=30)
    apps = box_call(api, token, {"action": "apps", "session": session}, timeout=45)
    assert_ok(apps, "workstation app inventory")
    if not isinstance(apps.get("apps"), dict):
        fail("computer_apps did not return a real installed-app inventory")


def check_gui(api: str, token: str, session: str, marker: str) -> None:
    status = desktop_call(api, token, {"action": "status", "session": session})
    assert_ok(status, "desktop status")
    if status.get("phase") == "busy":
        fail("desktop Studio is already assigned to another session")
    available_mb = status.get("available_mb")
    minimum_mb = status.get("minimum_available_mb")
    if not isinstance(available_mb, (int, float)) or available_mb < 3072:
        fail(f"graphical desktop requires at least 3072 MB available; reported {available_mb} MB")
    if not isinstance(minimum_mb, (int, float)) or minimum_mb < 3072:
        fail(f"desktop admission limit is too low or missing: {minimum_mb} MB")
    if status.get("can_start") is not True:
        fail(
            "desktop start admission refused: "
            + str(status.get("error") or f"available memory {available_mb} MB")
        )
    print(f"Desktop capacity: {available_mb} MB available; desktop floor {minimum_mb} MB", flush=True)

    start = desktop_call(api, token, {"action": "start", "session": session}, timeout=55)
    assert_ok(start, "desktop start request")
    deadline = time.monotonic() + 360
    current = start
    while time.monotonic() < deadline:
        phase = str(current.get("phase") or "")
        if phase == "running":
            break
        if phase in ("failed", "stopped", "busy"):
            fail("desktop failed to start: " + str(current.get("error") or phase)[:240])
        time.sleep(3)
        current = desktop_call(api, token, {"action": "status", "session": session}, timeout=55)
        assert_ok(current, "desktop startup status")
    else:
        fail("desktop did not reach running phase within six minutes")

    try:
        frame = desktop_call(api, token, {"action": "frame", "session": session}, timeout=60)
        assert_ok(frame, "desktop screenshot")
        shot = frame.get("screenshot_b64")
        if not isinstance(shot, str) or len(shot) < 1_000:
            fail("desktop did not return a real screenshot frame")
        # While the GUI remains open, prove the same model computer can still execute Bash.
        ran = box_call(
            api,
            token,
            {
                "action": "run",
                "session": session,
                "timeout": 20,
                "command": f"printf 'BASH_WITH_GUI_OK:{marker}\\n'; id -u",
            },
            timeout=40,
        )
        assert_ok(ran, "terminal command while GUI is running")
        if ran.get("exit_code") != 0 or f"BASH_WITH_GUI_OK:{marker}" not in str(ran.get("output", "")):
            fail("model terminal did not work while the graphical desktop was running")
        if os.environ.get("SMOKE_LIVE") == "1":
            print("LIVE " + json.dumps(check_live(api, token, session, marker, os.environ.get("SMOKE_FRAMES_DIR", "")), separators=(",", ":")), flush=True)
    finally:
        stopped = desktop_call(api, token, {"action": "stop", "session": session}, timeout=55)
        assert_ok(stopped, "desktop stop")


def check_browser(api: str, token: str, session: str, marker: str) -> None:
    opened = gradio_call(api, "browser_do",
                         {"action": "open", "url": "https://example.com", "session": session},
                         token, timeout=180)
    if opened.get("ok") is not True:
        try:
            raw = request_json("POST", f"{api}/gradio_api/run/browser_status", token, {"data": []}, timeout=35)
            state = raw.get("data", raw)
            if isinstance(state, list):
                state = state[0] if state else {}
            if isinstance(state, str):
                try:
                    state = json.loads(state)
                except ValueError:
                    state = {"raw": state[:1000]}
        except Exception as exc:  # noqa: BLE001
            state = {"status_error": f"{type(exc).__name__}: {str(exc)[:300]}"}
        fail("headless browser open: " + str(opened.get("error") or "unknown error")[:1800]
             + "; browser diagnostics: " + json.dumps(state, ensure_ascii=False)[:2600])
    if "example.com" not in str(opened.get("url") or "").lower() or not opened.get("title") or not opened.get("text"):
        fail("headless browser did not return the expected public page URL, title and text")

    # Create an actual same-session local preview server and exercise browser file transfers.
    port = 18000 + (int(marker[-4:], 16) % 40000)
    server_file = f".ci-preview-server-{marker}.py"
    upload_file = f".ci-upload-{marker}.txt"
    download_file = f"Downloads/.ci-download-{marker}.txt"
    server_code = r'''import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
MARKER = "__MARKER__"
PAGE = ("""<!doctype html><html><body><p>LOCAL_PREVIEW_""" + MARKER + """</p>
<input id="upload" type="file" onchange="const d=new FormData();d.append('file',this.files[0]);fetch('/upload',{method:'POST',body:d}).then(r=>r.text()).then(t=>document.getElementById('result').innerText=t)">
<div id="result"></div><a id="download" href="/download">download test file</a></body></html>""").encode()
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass
    def do_GET(self):
        if self.path == "/download":
            body = ("DOWNLOAD_OK_" + MARKER).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Disposition", "attachment; filename=computer-smoke.txt")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(PAGE)))
        self.end_headers()
        self.wfile.write(PAGE)
    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        body = ("UPLOAD_OK_" + MARKER).encode() if MARKER.encode() in raw else b"UPLOAD_FAIL"
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
HTTPServer(("127.0.0.1", int(sys.argv[1])), Handler).serve_forever()
'''
    server_code = server_code.replace("__MARKER__", marker)
    box_call(api, token, {"action": "write", "session": session, "path": server_file, "content": server_code}, timeout=45)
    box_call(api, token, {"action": "write", "session": session, "path": upload_file, "content": "UPLOAD_SOURCE_" + marker}, timeout=45)
    job = box_call(api, token, {"action": "job_start", "session": session, "name": "ci-local-preview",
                               "command": f"python3 '{server_file}' {port}"}, timeout=45)
    assert_ok(job, "same-session preview server start")
    job_id = str(job.get("id") or "")
    if not job_id:
        fail("same-session preview server did not return a background job id")
    try:
        time.sleep(1.5)
        created_tab = gradio_call(api, "browser_do", {"action": "new_tab", "session": session}, token, timeout=60)
        assert_ok(created_tab, "new browser tab")
        local_url = f"http://127.0.0.1:{port}/"
        local = gradio_call(api, "browser_do", {"action": "open", "url": local_url, "session": session}, token, timeout=90)
        assert_ok(local, "same-session localhost preview")
        if marker not in str(local.get("text") or ""):
            fail("browser opened the local server but did not return its session marker")
        tabs = gradio_call(api, "browser_do", {"action": "tabs", "session": session}, token, timeout=45)
        assert_ok(tabs, "browser tab inventory")
        if len(tabs.get("tabs") or []) < 2:
            fail("browser tabs API did not retain the second tab")
        uploaded = gradio_call(api, "browser_do", {"action": "upload", "selector": "#upload",
                                                    "file_path": upload_file, "session": session}, token, timeout=60)
        assert_ok(uploaded, "browser file upload")
        waited = gradio_call(api, "browser_do", {"action": "wait", "text": "UPLOAD_OK_" + marker,
                                                  "seconds": 10, "session": session}, token, timeout=45)
        assert_ok(waited, "browser upload completion")
        if "UPLOAD_OK_" + marker not in str(waited.get("text") or ""):
            fail("local preview server did not receive the uploaded file")
        downloaded = gradio_call(api, "browser_do", {"action": "download", "selector": "#download",
                                                       "output_path": download_file, "session": session}, token, timeout=60)
        assert_ok(downloaded, "browser file download")
        restored = box_call(api, token, {"action": "read", "session": session, "path": download_file}, timeout=45)
        assert_ok(restored, "read downloaded file")
        if "DOWNLOAD_OK_" + marker not in str(restored.get("text") or ""):
            fail("downloaded file contents did not arrive in the computer workspace")
        errors = gradio_call(api, "browser_do", {"action": "console", "session": session}, token, timeout=45)
        assert_ok(errors, "browser console diagnostics")
        network = gradio_call(api, "browser_do", {"action": "network", "session": session}, token, timeout=45)
        assert_ok(network, "browser network diagnostics")
        gradio_call(api, "browser_do", {"action": "close_tab", "session": session}, token, timeout=45)
    finally:
        box_call(api, token, {"action": "job_stop", "session": session, "id": job_id}, timeout=45)
        box_call(api, token, {"action": "run", "session": session, "timeout": 10,
                              "command": f"rm -f '{server_file}' '{upload_file}' '{download_file}'"}, timeout=30)


def bench(api: str, token: str, session: str) -> dict[str, Any]:
    """Wall-clock seconds of the operations models use most (each through the real Gradio RPC, so it includes the hub's round trip).
    An action the deployed hub does not know yet is reported as unsupported, so the same script measures before and after an upgrade."""
    out: dict[str, Any] = {}

    def timed(name: str, payload: dict[str, Any], timeout: int = 150) -> dict[str, Any]:
        t0 = time.time()
        try:
            r = box_call(api, token, {"session": session, **payload}, timeout)
        except Exception as exc:  # noqa: BLE001
            out[name] = {"ok": False, "error": str(exc)[:120]}
            return {}
        ok = bool(r.get("ok")) and (r.get("exit_code") in (None, 0))
        out[name] = {"s": round(time.time() - t0, 2), "ok": ok, **({} if ok else {"error": str(r.get("error") or r.get("output") or "")[:120]})}
        return r

    timed("echo", {"action": "run", "command": "echo hi"})
    timed("echo_2", {"action": "run", "command": "echo hi"})
    timed("write_200kb", {"action": "write", "path": "bench/big.txt", "content": "x" * 200_000})
    timed("read_dir", {"action": "read", "path": "bench"})
    t_repo = time.time()
    repo = timed("repo_clone", {"action": "repo", "url": "https://github.com/psf/requests"}, 240)
    job = str(repo.get("job") or "")
    if job:                                   # still downloading when the call answered: time the whole clone through the job log
        for _ in range(60):
            try:
                log = box_call(api, token, {"session": session, "action": "job_log", "id": job, "tail": 5}, 60)
            except Exception:  # noqa: BLE001
                break
            if not log.get("running"):
                out["repo_clone_total"] = {"s": round(time.time() - t_repo, 2), "ok": log.get("exit_code") == 0, **({} if log.get("exit_code") == 0 else {"tail": str(log.get("output") or "")[-300:]})}
                break
            time.sleep(3)
    timed("search_repo", {"action": "search", "pattern": "def request", "path": "repos"})
    tv = timed("tools_versions", {"action": "run", "command": "for t in git gh rg jq ffmpeg node python3 patch fdfind pandoc; do printf '%s=' $t; command -v $t >/dev/null && echo yes || echo no; done"})
    out["tools_present"] = " ".join(x for x in str(tv.get("output") or "").split() if x.endswith("=yes")).replace("=yes", "")
    if job:
        try:
            fin = box_call(api, token, {"session": session, "action": "job_log", "id": job, "tail": 200}, 60)
            out["repo_clone_markers"] = " | ".join(l for l in str(fin.get("output") or "").splitlines() if "fetched" in l or "baseline" in l or "failed at" in l)[:200]
        except Exception:  # noqa: BLE001
            pass
    timed("write_src", {"action": "write", "path": "bench/p/a.txt", "content": "one\ntwo\n"})
    timed("patch", {"action": "patch", "cwd": "bench/p", "diff": "--- a/a.txt\n+++ b/a.txt\n@@ -1,2 +1,2 @@\n one\n-two\n+three\n"})
    timed("tools", {"action": "tools"})
    b = timed("batch_5", {"action": "batch", "steps": [{"action": "run", "command": "echo 1"}, {"action": "write", "path": "bench/b.txt", "content": "b"}, {"action": "read", "path": "bench/b.txt"}, {"action": "search", "pattern": "b", "path": "bench"}, {"action": "run", "command": "echo 5"}]})
    if b:
        out["batch_5"]["steps_ok"] = sum(1 for r in (b.get("results") or []) if r.get("ok"))
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", required=True, help="ModelScope Studio inference API base URL")
    parser.add_argument("--model-id", required=True, choices=("computer_hub", "coder", "sham", "sham_v2", "qwen35-9b", "gemma4-e4b", "minicpmo45"))
    parser.add_argument("--no-gui", action="store_true", help="Run only persistent terminal/file/job smoke tests")
    parser.add_argument("--browser", action="store_true", help="Also open a public page in the isolated headless browser")
    parser.add_argument("--bench", action="store_true", help="Also time the common operations (prints one BENCH json line)")
    args = parser.parse_args()
    token = (os.environ.get("MODELSCOPE_TOKEN") or os.environ.get("MODELSCOPE_API_TOKEN") or "").strip()
    if not token:
        print("ERROR: MODELSCOPE_TOKEN is not configured", file=sys.stderr)
        return 2
    api = args.api.rstrip("/")
    if not api.startswith("https://studio-") or not api.endswith(".api-inference.modelscope.net"):
        print("ERROR: refusing an unexpected Studio API host", file=sys.stderr)
        return 2
    run_id = os.environ.get("GITHUB_RUN_ID", str(int(time.time())))
    marker = uuid.uuid4().hex[:12]
    session = f"ci-smoke:{run_id}:{args.model_id}:{marker}"
    try:
        print(f"[{args.model_id}] checking persistent computer RPCs", flush=True)
        check_shell(api, token, session, marker)
        print(f"[{args.model_id}] PASS: Bash, persistent files, and background jobs", flush=True)
        print(f"[{args.model_id}] checking private file banks and workstation app inventory", flush=True)
        check_banks(api, token, session, marker)
        print(f"[{args.model_id}] PASS: file bank create/store/search/restore and app inventory", flush=True)
        if not args.no_gui:
            print(f"[{args.model_id}] checking X11 desktop and terminal coexistence", flush=True)
            check_gui(api, token, session, marker)
            print(f"[{args.model_id}] PASS: X11 screenshot and terminal while GUI is running", flush=True)
        if args.browser:
            print(f"[{args.model_id}] checking the isolated Chromium browser", flush=True)
            check_browser(api, token, session, marker)
            print(f"[{args.model_id}] PASS: Chromium public/local preview, tabs, upload and download", flush=True)
        if args.bench:
            print("BENCH " + json.dumps(bench(api, token, session), separators=(",", ":")), flush=True)
        print(f"[{args.model_id}] PASS: selected Studio computer smoke test complete", flush=True)
        return 0
    except Exception as exc:
        # Keep secrets, prompts, file contents, and screenshots out of CI logs.
        print(f"[{args.model_id}] FAIL: {str(exc)[:1200]}", file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
