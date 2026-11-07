#!/usr/bin/env python3
"""Live smoke test for Sham v2's native-role Qwen3 chat API."""
from __future__ import annotations

import base64
import json
import os
import re
import time
import uuid
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

BASE = (os.environ.get("SHAM_V2_URL") or "https://studio-novaai2026-sham-v2-server.api-inference.modelscope.net").strip().rstrip("/")
TOKEN = (os.environ.get("MODELSCOPE_TOKEN") or os.environ.get("MODELSCOPE_API_TOKEN") or "").strip()
EXPECTED_MODEL = "novaai2026/sham-v2"
COMPUTER_BASE = (os.environ.get("COMPUTER_STUDIO_URL") or "https://studio-novaai2026-nova-inference-server.api-inference.modelscope.net").strip().rstrip("/")


def request_json(url: str, method: str = "GET", payload: dict | None = None, timeout: int = 45):
    headers = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}
    data = json.dumps(payload or {}, ensure_ascii=False).encode("utf-8") if payload is not None else None
    # the shared gateway answers 429/502-504 when several live checks hit it at once: wait and retry a few times
    waits = [3, 8, 15, 30]
    for attempt in range(len(waits) + 1):
        req = Request(url, data=data, headers=headers, method=method)
        try:
            with urlopen(req, timeout=timeout) as res:
                return json.loads(res.read().decode("utf-8"))
        except HTTPError as exc:
            if exc.code not in (429, 502, 503, 504) or attempt == len(waits):
                raise
            time.sleep(waits[attempt])


def unwrap_line(line: str):
    if not line.startswith("data:"):
        return None
    try:
        values = json.loads(line[5:].strip())
    except json.JSONDecodeError:
        return None
    value = values[0] if isinstance(values, list) and values else values
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value
    return value


def call(api: str, payload: dict, timeout: int = 180):
    submitted = request_json(f"{BASE}/gradio_api/call/v2/{api}", "POST", payload, timeout=40)
    event_id = submitted.get("event_id")
    if not event_id:
        raise RuntimeError(f"{api}: no event_id returned")
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        req = Request(f"{BASE}/gradio_api/call/{api}/{event_id}", headers={"Authorization": f"Bearer {TOKEN}"})
        try:
            with urlopen(req, timeout=min(30, max(5, int(deadline - time.monotonic())))) as res:
                while time.monotonic() < deadline:
                    line = res.readline()
                    if not line:
                        break
                    value = unwrap_line(line.decode("utf-8", errors="replace"))
                    if value is not None:
                        return value
        except (TimeoutError, URLError, OSError):
            pass
        time.sleep(1)
    raise TimeoutError(f"{api}: timed out after {timeout}s")


def chat(messages: list[dict], max_new_tokens: int = 256) -> str:
    result = call("generate_chat", {
        "messages_json": json.dumps(messages, ensure_ascii=False),
        "max_new_tokens": max_new_tokens,
        "temperature": 0.2,
        "think_tokens": 0,
    }, timeout=240)
    if isinstance(result, str):
        try:
            result = json.loads(result)
        except json.JSONDecodeError:
            result = {"type": "text", "text": result}
    if not isinstance(result, dict) or result.get("type") != "text":
        raise RuntimeError(f"generate_chat did not return text: {str(result)[:300]}")
    answer = str(result.get("text") or "").strip()
    if not answer:
        raise RuntimeError("generate_chat returned an empty answer")
    return answer




def call_computer_box(payload: dict, timeout: int = 90):
    if "nova-inference-server" not in COMPUTER_BASE.lower() or not COMPUTER_BASE.startswith("https://studio-"):
        raise RuntimeError("Refusing to send Sham v2 computer calls outside the reserved shared computer Studio")
    wire = "b64:" + base64.b64encode(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")).decode("ascii")
    submitted = request_json(f"{COMPUTER_BASE}/gradio_api/call/box_do", "POST", {"data": [wire]}, timeout=40)
    event_id = submitted.get("event_id")
    if not event_id:
        raise RuntimeError("Sham v2 computer Studio did not return an event id")
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        req = Request(f"{COMPUTER_BASE}/gradio_api/call/box_do/{event_id}", headers={"Authorization": f"Bearer {TOKEN}"})
        try:
            with urlopen(req, timeout=min(30, max(5, int(deadline - time.monotonic())))) as res:
                while time.monotonic() < deadline:
                    line = res.readline()
                    if not line:
                        break
                    value = unwrap_line(line.decode("utf-8", errors="replace"))
                    if value is not None:
                        if isinstance(value, str):
                            try:
                                value = json.loads(value)
                            except json.JSONDecodeError:
                                pass
                        if not isinstance(value, dict):
                            raise RuntimeError("computer Studio returned an unreadable result")
                        return value
        except (TimeoutError, URLError, OSError):
            pass
        time.sleep(0.5)
    raise TimeoutError(f"box_do: timed out after {timeout}s")


def native_model_terminal_smoke() -> None:
    """Have Sham v2 choose computer_run itself, then execute that exact safe call on its own Studio."""
    marker = "SHAM_V2_MODEL_TERMINAL_TOOL_OK"
    session = f"ci-sham-v2-agent:{os.environ.get('GITHUB_RUN_ID', 'manual')}:{uuid.uuid4().hex[:10]}"
    tools = [{
        "type": "function",
        "function": {
            "name": "computer_run",
            "description": "Run a real Bash command in the selected model's persistent Linux computer.",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "Bash command"},
                    "cwd": {"type": "string"},
                    "timeout": {"type": "number"},
                },
                "required": ["command"],
            },
        },
    }]
    command = f"printf '{marker}'; id -u"
    prompt = (
        "أنت وكيل يعمل على حاسوب Linux خاص بالنموذج المحدد.\n"
        "الأدوات المتاحة لك:\n"
        "- computer_run(command, cwd?, timeout?) — نفّذ أمراً حقيقياً في طرفيتك الدائمة.\n"
        "طلب المستخدم: اختبر الطرفية الآن. استدعِ computer_run مرة واحدة فقط، "
        "واجعل arguments.command يساوي حرفياً هذا الأمر الآمن: " + command + ". "
        "لا تكتب إجابة نهائية قبل استدعاء الأداة."
    )
    response = call("agent_step", {
        "prompt": prompt,
        "tools_json": json.dumps(tools, ensure_ascii=False, separators=(",", ":")),
        "max_new_tokens": 192,
    }, timeout=240)
    if isinstance(response, str):
        try:
            response = json.loads(response)
        except json.JSONDecodeError:
            raise RuntimeError("agent_step did not return a structured result")
    if not isinstance(response, dict) or response.get("type") != "tool_calls":
        raise RuntimeError("Sham v2 did not choose a structured computer_run tool call: " + str(response)[:280])
    calls = response.get("tool_calls") or []
    if len(calls) != 1 or (calls[0].get("function") or {}).get("name") != "computer_run":
        raise RuntimeError("Sham v2 selected a tool other than its own computer_run")
    raw_args = calls[0]["function"].get("arguments")
    args = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
    if not isinstance(args, dict):
        raise RuntimeError("Sham v2 computer_run arguments were malformed")
    generated_command = str(args.get("command") or "")
    safe_command = re.fullmatch(r"\s*printf\s+(['\"])"+re.escape(marker)+r"\1\s*;\s*id\s+-u\s*", generated_command)
    if not safe_command:
        raise RuntimeError("Sham v2 requested an unexpected terminal command; no generated command was executed")
    executed = call_computer_box({
        "action": "run",
        "session": session,
        "command": generated_command,
        "timeout": 20,
        "cwd": ".",
    }, timeout=45)
    output = str(executed.get("output") or "")
    if executed.get("ok") is not True or executed.get("exit_code") != 0 or marker not in output:
        raise RuntimeError("Sham v2's selected computer_run did not execute successfully: " + output[:180])
    uid = output.splitlines()[-1].strip() if output.splitlines() else ""
    if uid == "0":
        raise RuntimeError("Sham v2 computer terminal unexpectedly executed as root")
    print(f"PASS Sham v2 itself selected computer_run and executed it in its own persistent computer (uid={uid})")

    final = call("agent_step", {
        "prompt": (
            "نتيجة أداة computer_run التي استدعيتها: " + output[:240] +
            "\\nأخبر المستخدم باختصار أن الأمر نُفّذ بالفعل، واذكر الرمز " + marker + ". لا تستدع أي أداة."
        ),
        "tools_json": "[]",
        "max_new_tokens": 96,
    }, timeout=180)
    if isinstance(final, str):
        try:
            final = json.loads(final)
        except json.JSONDecodeError:
            raise RuntimeError("Sham v2 did not return a final tool-result response")
    if not isinstance(final, dict) or final.get("type") != "text" or marker not in str(final.get("text") or ""):
        raise RuntimeError("Sham v2 did not correctly read the computer tool result")
    print("PASS Sham v2 read the real terminal result and answered from it")


def main() -> int:
    if not TOKEN:
        raise RuntimeError("MODELSCOPE_TOKEN is missing")
    if "sham-v1" in BASE.lower() or "nova-inference-server" in BASE.lower() or "coder-inference" in BASE.lower():
        raise RuntimeError("Refusing to test a non-v2 Studio URL")
    if "sham-v2-server" not in BASE.lower():
        raise RuntimeError("Refusing to test anything except Sham v2's dedicated primary Studio")

    status = None
    deadline = time.time() + 300
    while time.time() < deadline:
        try:
            status = call("status", {}, timeout=30)
        except (TimeoutError, URLError, OSError) as exc:
            # During a Studio restart ModelScope may briefly return HTTP 404/503.
            # Treat that as "deploying" and retry within the same 300s deadline.
            status = {"phase": "deploying", "error": type(exc).__name__}
            time.sleep(5)
            continue
        if isinstance(status, str):
            try:
                status = json.loads(status)
            except json.JSONDecodeError:
                status = {}
        context = int(status.get("context_tokens") or 0) if isinstance(status, dict) else 0
        if (isinstance(status, dict) and status.get("phase") == "ready"
                and status.get("model") == EXPECTED_MODEL and context >= 4096):
            break
        # The runtime-code publish and Studio restart are triggered by the same push.
        # Wait for the new worker instead of failing against the old ready worker.
        time.sleep(5)
    if not isinstance(status, dict) or status.get("phase") != "ready":
        raise RuntimeError(f"Sham v2 Studio is not ready: {json.dumps(status, ensure_ascii=False)[:500]}")
    if status.get("model") != EXPECTED_MODEL:
        raise RuntimeError(f"Wrong model in v2 Studio: {status.get('model')!r}")
    context = int(status.get("context_tokens") or 0)
    if context < 4096:
        raise RuntimeError(f"v2 context did not reach 4096 tokens before the 300s deadline (reported {context}); check the Studio deploy logs")

    identity = chat([{"role": "user", "content": "من أنت؟"}], 160)
    print(f"PASS Sham v2 model-authored identity response (wording unrestricted): {identity[:240]}")

    answer = chat([{"role": "user", "content": "ما عاصمة سوريا؟"}], 128)
    if answer.strip() == "ما عاصمة سوريا؟":
        raise RuntimeError("model returned the question verbatim")
    if "دمشق" not in answer:
        raise RuntimeError(f"model failed the Syria-capital smoke check: {answer[:240]!r}")
    print(f"PASS Sham v2 factual response: {answer[:300]}")

    followup = chat([
        {"role": "user", "content": "اسمي سارة."},
        {"role": "assistant", "content": "مرحباً سارة."},
        {"role": "user", "content": "ما اسمي؟"},
    ], 128)
    print(f"PASS Sham v2 multi-turn response: {followup[:240]}")

    native_model_terminal_smoke()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
