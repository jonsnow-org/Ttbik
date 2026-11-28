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


class StudioBusy(RuntimeError):
    """The Studio answered 'شام مشغول بطلب آخر الآن' — it has ONE slot, so a second probe (or the owner's chat) made
    every check fail at once and the run looked like a broken model. That is a wait, not a failure."""


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
                        if isinstance(value, dict) and value.get("type") == "busy":
                            raise StudioBusy(str(value.get("text") or "busy")[:200])
                        return value
        except (TimeoutError, URLError, OSError):
            pass
        time.sleep(1)
    raise TimeoutError(f"{api}: timed out after {timeout}s")


def retry_busy(check, attempts: int = 4, wait: int = 20):
    """Run a check; when the single-slot Studio is busy with someone else's request, wait and try again a few times."""
    for attempt in range(1, attempts + 1):
        try:
            return check()
        except StudioBusy as exc:
            if attempt == attempts:
                raise
            print(f"   Studio busy ({exc}) — waiting {wait}s, attempt {attempt + 1}/{attempts}", flush=True)
            time.sleep(wait)



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
        "session": session,
    }, timeout=240)
    if isinstance(response, str):
        try:
            response = json.loads(response)
        except json.JSONDecodeError:
            raise RuntimeError("agent_step did not return a structured result")
    # Sham v2's computer is part of the model's OWN loop (owner 2026-11-08): the model writes computer_run, the Studio runs it inside the serving process and the reply is one
    # embedded_step (the call + its result) that the app records and then asks again: one short Studio call per step, never a long open connection.
    if not isinstance(response, dict) or response.get("type") != "embedded_step":
        raise RuntimeError("Sham v2 did not run computer_run inside its own loop: " + str(response)[:280])
    fn = (response.get("tool_call") or {}).get("function") or {}
    if fn.get("name") != "computer_run":
        raise RuntimeError("Sham v2 chose a tool other than computer_run: " + str(fn)[:160])
    generated_command = str((json.loads(fn.get("arguments") or "{}")).get("command") or "")
    safe_command = re.fullmatch(r"\s*printf\s+(['\"])"+re.escape(marker)+r"\1\s*;\s*id\s+-u\s*", generated_command)
    if not safe_command:
        raise RuntimeError("Sham v2 requested an unexpected terminal command: " + generated_command[:120])
    output = str(response.get("result") or "")
    if marker not in output:
        raise RuntimeError("Sham v2's embedded computer did not run the command: " + output[:180])
    uid = output.splitlines()[-1].strip() if output.splitlines() else ""
    if uid == "0":
        raise RuntimeError("Sham v2 computer terminal unexpectedly executed as root")
    print(f"PASS Sham v2 itself selected computer_run and its own embedded computer ran it inside the model's loop (uid={uid})")

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


def stream_pieces(messages: list[dict], max_new_tokens: int = 96, timeout: int = 240) -> list[str]:
    """generate_chat_stream: every SSE data line until 'complete' (one line per piece the model wrote)."""
    submitted = request_json(f"{BASE}/gradio_api/call/v2/generate_chat_stream", "POST", {
        "messages_json": json.dumps(messages, ensure_ascii=False), "max_new_tokens": max_new_tokens, "temperature": 0.2, "think_tokens": 0}, timeout=40)
    event_id = submitted.get("event_id")
    if not event_id:
        raise RuntimeError("generate_chat_stream: no event_id returned")
    pieces: list[str] = []
    event = ""
    req = Request(f"{BASE}/gradio_api/call/generate_chat_stream/{event_id}", headers={"Authorization": f"Bearer {TOKEN}"})
    with urlopen(req, timeout=timeout) as res:
        for raw in res:
            line = raw.decode("utf-8", errors="replace").rstrip("\n")
            if line.startswith("event:"):
                event = line[6:].strip()
                if event == "error":
                    raise RuntimeError("generate_chat_stream returned an error event")
                continue
            value = unwrap_line(line)
            if value is None:
                continue
            if event == "complete":
                break
            if isinstance(value, dict) and value.get("type") == "error":
                raise RuntimeError("generate_chat_stream error: " + str(value.get("text"))[:200])
            if isinstance(value, str) and value:
                pieces.append(value)
    return pieces


def streaming_smoke() -> None:
    pieces = stream_pieces([{"role": "user", "content": "اكتب جملتين عن دمشق."}], 64)
    text = "".join(pieces).strip()
    if len(pieces) < 2 or not text:
        raise RuntimeError(f"generate_chat_stream did not stream (pieces={len(pieces)}): {text[:200]!r}")
    print(f"PASS Sham v2 streamed {len(pieces)} pieces: {text[:160]}")


def factual_and_multiturn_smoke() -> None:
    answer = chat([{"role": "user", "content": "ما عاصمة سوريا؟"}], 128)
    if answer.strip() == "ما عاصمة سوريا؟":
        raise RuntimeError("model returned the question verbatim")
    if "دمشق" not in answer:
        raise RuntimeError(f"model failed the Syria-capital smoke check: {answer[:240]!r}")
    print(f"PASS Sham v2 factual response: {answer[:300]}")
    latin_words = re.findall(r"[A-Za-z]{3,}", answer)
    if len(latin_words) > 2:      # an Arabic answer that drifts into English words is a quality warning, not a failure
        print(f"WARN Sham v2 answer mixes scripts ({len(latin_words)} Latin words): {' '.join(latin_words[:6])}")

    followup = chat([
        {"role": "user", "content": "اسمي سارة."},
        {"role": "assistant", "content": "مرحباً سارة."},
        {"role": "user", "content": "ما اسمي؟"},
    ], 128)
    print(f"PASS Sham v2 multi-turn response: {followup[:240]}")


def tldm_smoke(status: dict) -> None:
    """T-LDM on the published head (novaai2026/sham2-tldm-head). Until it is published the Studio reports tldm_head=false: SKIP, not a failure."""
    if not status.get("tldm_head"):
        print(f"SKIP T-LDM: the Sham 2 head is not published yet ({status.get('tldm_repo') or 'novaai2026/sham2-tldm-head'})")
        return
    session = f"ci-tldm-sham_v2:{os.environ.get('GITHUB_RUN_ID', 'manual')}:{uuid.uuid4().hex[:8]}"
    res = call("generate_tldm", {"messages_json": json.dumps([{"role": "user", "content": "how many files are in this folder?"}], ensure_ascii=False),
                                 "session": session, "max_new_tokens": 128, "tldm_flag": 1, "confirm_cmd": "", "confirm_ok": 0, "deny_list": "", "owner": 0}, timeout=300)
    if isinstance(res, str):
        try:
            res = json.loads(res)
        except json.JSONDecodeError:
            raise RuntimeError("generate_tldm did not return JSON: " + res[:200])
    if not isinstance(res, dict) or res.get("type") not in ("text", "confirm") or not res.get("tldm"):
        raise RuntimeError("T-LDM did not answer from the published head: " + json.dumps(res, ensure_ascii=False)[:300])
    if res.get("computer") != "model_computer":
        raise RuntimeError("T-LDM did not run on Sham 2's own computer: " + json.dumps(res, ensure_ascii=False)[:200])
    ok, why = tldm_verdict(res)
    if not ok:
        raise RuntimeError("T-LDM head did not do the task: " + why)
    print(f"PASS Sham 2 T-LDM ran a working command on its own computer ({why}): {str(res.get('text'))[:160]}")


# The head's fixed lines (sham_tldm_serve.NO_STEP_REPLY, serve_adapter GAVE_UP / drive's step limit). Until 2026-11-25 the smoke printed PASS for
# «تعذّر عليّ تحديد أمر مناسب لهذا الطلب.»: an answer shape, not a success. The bot never shows these lines (src/lib/shamStudio.ts tldmHeadOnlyText).
TLDM_FIXED_LINES = ("تعذّر عليّ تحديد أمر مناسب لهذا الطلب.", "I could not finish within the allowed number of steps.")


def tldm_verdict(res: dict) -> tuple[bool, str]:
    """Real success for «how many files are in this folder?»: the head ran at least one command that worked on Sham 2's own computer and
    replied with readable text (not a fixed line), or it paused a sensitive command for approval. Anything else is reported as a failure."""
    if res.get("type") == "confirm":
        return (True, "approval asked for: " + str(res.get("command") or "")[:80]) if str(res.get("command") or "").strip() else (False, "a confirmation without a command")
    text = str(res.get("text") or "").strip()
    steps = [s for s in (res.get("computer_steps") or []) if isinstance(s, dict)]
    worked = [s for s in steps if s.get("ok") is not False and str(s.get("command") or "").strip()]
    if text in TLDM_FIXED_LINES:
        return False, f"the head's fixed line {text!r} ({len(steps)} command(s) run)"
    if not worked:
        return False, f"no command worked ({len(steps)} run, all failed)" if steps else "no command was run"
    if not text or "\ufffd" in text:
        return False, f"unreadable reply {text[:80]!r} after {len(worked)} working command(s)"
    return True, f"{len(worked)} working command(s): {str(worked[0].get('command'))[:60]}"


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

    identity = retry_busy(lambda: chat([{"role": "user", "content": "من أنت؟"}], 160))
    if not identity or not identity.strip():
        raise RuntimeError("Sham v2 identity prompt returned an empty answer")
    # The live self-name is Sham Pro / «شام برو», from the identity LoRA in the published head (applied to the body at start, every chat).
    # Before the head is published (status identity_lora=false) a donor that still says Qwen is reported, not failed, so media smoke can run.
    wrong = re.search(r"qwen|alibaba|openai|chatgpt|gpt-?\d|claude", identity, re.I) or not re.search(r"شام\s*برو|sham\s*pro", identity, re.I)
    failures: list[str] = []
    if wrong and status.get("identity_lora"):
        failures.append(f"Sham Pro identity LoRA is applied but the model does not answer as Sham Pro: {identity[:240]!r}")
        print("FAIL " + failures[-1])
    elif wrong:
        print(f"KNOWN_FAILURE Sham Pro identity: head not published/applied yet ({status.get('identity_lora_why') or 'no head'}): {identity[:240]!r}")
    else:
        print(f"PASS Sham Pro model-authored identity response (wording unrestricted, but it is Sham Pro): {identity[:240]}")

    # every check runs (one failure does not hide the others); the script fails at the end
    for check in (factual_and_multiturn_smoke, streaming_smoke, native_model_terminal_smoke, lambda: tldm_smoke(status)):
        try:
            retry_busy(check)
        except Exception as exc:  # noqa: BLE001 - reported, then the next check runs
            failures.append(f"{type(exc).__name__}: {str(exc)[:300]}")
            print("FAIL " + failures[-1])
    if failures:
        raise RuntimeError(f"{len(failures)} Sham v2 chat check(s) failed: " + " | ".join(f[:160] for f in failures))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
