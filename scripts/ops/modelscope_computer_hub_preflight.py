#!/usr/bin/env python3
"""Wait for and inspect the dedicated 16-GB ModelScope computer, then warm its browser.

This is a read-only readiness check apart from explicitly starting the browser
bootstrap. The later live smoke uses a throwaway session and cleans its test file.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from typing import Any


def fail(message: str) -> None:
    raise RuntimeError(message)


def request_run(api: str, name: str, token: str, timeout: int = 35) -> Any:
    url = f"{api}/gradio_api/run/{name}"
    payload = json.dumps({"data": []}, separators=(",", ":")).encode()
    request = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Authorization": "Bearer " + token,
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "Ttbik-Computer-Hub-Preflight/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read(3_000_000)
    except urllib.error.HTTPError as exc:
        if exc.code == 401:
            fail(f"{name}: ModelScope rejected the configured token (HTTP 401)")
        raise
    except (urllib.error.URLError, TimeoutError) as exc:
        raise RuntimeError(f"{name}: Studio request unavailable ({type(exc).__name__})") from exc
    try:
        decoded = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise RuntimeError(f"{name}: Studio returned invalid JSON") from exc
    value: Any = decoded.get("data", decoded) if isinstance(decoded, dict) else decoded
    if isinstance(value, list):
        value = value[0] if value else {}
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            pass
    return value


def wait_for_core(api: str, token: str, minutes: int) -> dict:
    deadline = time.monotonic() + max(1, minutes) * 60
    attempt = 0
    last_error = ""
    while time.monotonic() < deadline:
        attempt += 1
        try:
            status = request_run(api, "status", token)
            if not isinstance(status, dict):
                raise RuntimeError("status endpoint returned a non-object")
            if status.get("app_revision") != "computer-hub-16gb-2026-11-02-r2":
                raise RuntimeError("wrong computer-only app revision: " + str(status.get("app_revision")))
            if status.get("role") != "computer-only" or status.get("model_loaded") is not False:
                fail("The Studio is not in the required computer-only / no-model state.")
            bootstrap = status.get("bootstrap") or {}
            phase = str(bootstrap.get("phase") or "unknown") if isinstance(bootstrap, dict) else "unknown"
            if phase == "failed":
                fail("Computer bootstrap failed: " + json.dumps(bootstrap, ensure_ascii=False)[:1800])
            if phase == "ready":
                hardware = status.get("hardware") or {}
                computer = status.get("computer") or {}
                limits = computer.get("limits") or {}
                capacity = computer.get("capacity") or {}
                cleanup = status.get("legacy_minicpm_cache_cleanup") or {}
                preserved = set(cleanup.get("preserved") or [])
                if not {"/mnt/workspace/computer", "/mnt/workspace/browser"}.issubset(preserved):
                    fail("Cache-cleanup report does not confirm preservation of computer/browser data: " + json.dumps(cleanup))
                if limits.get("minimum_available_mb") != 2048 or limits.get("global_jobs") != 1:
                    fail("Terminal memory/concurrency policy does not match the 2-GB / single-job configuration: " + json.dumps(limits))
                if not isinstance(hardware.get("mem_total_gb"), (int, float)) or hardware["mem_total_gb"] < 14:
                    fail("Studio did not report the expected 16-GB memory class: " + json.dumps(hardware))
                print("COMPUTER_APP_READY", json.dumps({
                    "app_revision": status.get("app_revision"),
                    "role": status.get("role"),
                    "model_loaded": status.get("model_loaded"),
                    "hardware": hardware,
                    "terminal_limits": limits,
                    "terminal_capacity": capacity,
                    "desktop_packages": status.get("desktop"),
                    "apt_sources": computer.get("apt_sources"),
                    "bootstrap": bootstrap,
                    "legacy_minicpm_cache_cleanup": cleanup,
                }, ensure_ascii=False), flush=True)
                return status
            if attempt % 6 == 0:
                print(f"Computer bootstrap phase={phase}; waiting ({attempt})", flush=True)
        except RuntimeError:
            raise
        except Exception as exc:  # gateway startup and brief 5xx are retried
            last_error = f"{type(exc).__name__}: {str(exc)[:180]}"
            if attempt % 6 == 0:
                print(f"Computer API not ready yet: {last_error}", flush=True)
        time.sleep(10)
    fail(f"Computer-only app/core bootstrap did not become ready within {minutes} minutes; last={last_error}")
    return {}


def warm_browser(api: str, token: str, minutes: int) -> bool:
    try:
        state = request_run(api, "browser_status", token)
        if not isinstance(state, dict) or state.get("phase") != "ready":
            started = request_run(api, "browser_bootstrap", token)
            print("CHROMIUM_BOOTSTRAP", json.dumps(started, ensure_ascii=False)[:500], flush=True)
        else:
            print("CHROMIUM_ALREADY_READY", flush=True)
    except Exception as exc:
        print(f"WARNING: Chromium bootstrap could not be started: {type(exc).__name__}: {str(exc)[:180]}", flush=True)
        return False

    deadline = time.monotonic() + max(1, minutes) * 60
    attempt = 0
    while time.monotonic() < deadline:
        attempt += 1
        try:
            state = request_run(api, "browser_status", token)
            if isinstance(state, dict) and state.get("phase") == "ready":
                print("CHROMIUM_READY", json.dumps(state, ensure_ascii=False)[:1200], flush=True)
                return True
            if isinstance(state, dict) and state.get("phase") == "failed":
                print("WARNING: Chromium bootstrap failed: " + json.dumps(state, ensure_ascii=False)[:1200], flush=True)
                return False
            if attempt % 3 == 0:
                print("Chromium state:", json.dumps(state, ensure_ascii=False)[:500], flush=True)
        except Exception as exc:
            if attempt % 3 == 0:
                print(f"Chromium status unavailable: {type(exc).__name__}", flush=True)
        time.sleep(20)
    print(f"WARNING: Chromium did not become ready within {minutes} minutes; terminal/X11 checks will still run.", flush=True)
    return False


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", required=True)
    parser.add_argument("--bootstrap-minutes", type=int, default=45)
    parser.add_argument("--browser-minutes", type=int, default=20)
    args = parser.parse_args()
    token = (os.environ.get("MODELSCOPE_TOKEN") or "").strip()
    if not token:
        print("ERROR: MODELSCOPE_TOKEN is not configured", file=sys.stderr)
        return 2
    api = args.api.rstrip("/")
    if not api.startswith("https://studio-") or not api.endswith(".api-inference.modelscope.net"):
        print("ERROR: refusing an unexpected ModelScope host", file=sys.stderr)
        return 2
    try:
        wait_for_core(api, token, args.bootstrap_minutes)
        browser_ready = warm_browser(api, token, args.browser_minutes)
        env_file = os.environ.get("GITHUB_ENV")
        if env_file:
            with open(env_file, "a", encoding="utf-8") as handle:
                handle.write("BROWSER_READY=" + ("1" if browser_ready else "0") + "\n")
        return 0
    except Exception as exc:
        print("COMPUTER_HUB_PREFLIGHT_FAIL: " + str(exc)[:2200], file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
