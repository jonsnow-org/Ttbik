#!/usr/bin/env python3
"""Live capability-question smoke test for Sham v2's dedicated ModelScope Studio only."""
from __future__ import annotations

import difflib
import json
import os
import re
import time
import unicodedata
from urllib.error import URLError
from urllib.request import Request, urlopen

BASE = (os.environ.get("SHAM_V2_URL") or "https://studio-novaai2026-sham-v2-server.api-inference.modelscope.net").strip().rstrip("/")
TOKEN = (os.environ.get("MODELSCOPE_TOKEN") or "").strip()
EXPECTED_MODEL = "novaai2026/sham-v2"
QUESTION = "ماهي خبراتك ومهاراتك مالذي تستطيع القيام به وماهي الادوات المتوفرة والمتاحة لديك والتي تستطيع استدعائها عندما تنفذ مهام"


def request_json(url: str, method: str = "GET", payload: dict | None = None, timeout: int = 45):
    headers = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}
    data = json.dumps(payload or {}, ensure_ascii=False).encode("utf-8") if payload is not None else None
    req = Request(url, data=data, headers=headers, method=method)
    with urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode("utf-8"))


def unwrap(body: str):
    for line in body.splitlines():
        if not line.startswith("data:"):
            continue
        try:
            values = json.loads(line[5:].strip())
        except json.JSONDecodeError:
            continue
        value = values[0] if isinstance(values, list) and values else values
        if isinstance(value, str):
            try:
                return json.loads(value)
            except json.JSONDecodeError:
                return value
        return value
    return None


def call(api: str, payload: dict, timeout: int = 180):
    submitted = request_json(f"{BASE}/gradio_api/call/v2/{api}", "POST", payload, timeout=40)
    event_id = submitted.get("event_id")
    if not event_id:
        raise RuntimeError(f"{api}: no event_id returned")
    deadline = time.monotonic() + timeout
    last_error = ""
    # Read the SSE stream line-by-line. res.read() can wait forever on a stream
    # that keeps heartbeats alive, defeating the intended overall deadline.
    while time.monotonic() < deadline:
        req = Request(f"{BASE}/gradio_api/call/{api}/{event_id}", headers={"Authorization": f"Bearer {TOKEN}"})
        try:
            with urlopen(req, timeout=min(30, max(5, int(deadline - time.monotonic())))) as res:
                while time.monotonic() < deadline:
                    line = res.readline()
                    if not line:
                        break
                    value = unwrap(line.decode("utf-8", errors="replace"))
                    if value is not None:
                        return value
        except (TimeoutError, URLError, OSError) as exc:
            last_error = f"{type(exc).__name__}: {str(exc)[:100]}"
        time.sleep(1)
    raise TimeoutError(f"{api}: timed out after {timeout}s; last stream error: {last_error}")


def norm(value: str) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).lower()
    text = re.sub(r"[\u064B-\u065F\u0670\u0640]", "", text)
    return re.sub(r"[\W_]+", " ", text, flags=re.UNICODE).strip()


def check_answer(answer: str) -> None:
    actual = norm(answer)
    question = norm(QUESTION)
    if not actual:
        raise RuntimeError("v2 returned an empty text answer")
    ratio = min(len(actual), len(question)) / max(len(actual), len(question))
    similarity = difflib.SequenceMatcher(None, actual, question).ratio()
    prefix = " ".join(actual.split()[: len(question.split()) + 6])
    prefix_ratio = min(len(prefix), len(question)) / max(len(prefix), len(question))
    prefix_similarity = difflib.SequenceMatcher(None, prefix, question).ratio()
    if (
        actual == question
        or question in actual
        or (ratio >= 0.72 and similarity >= 0.84)
        or (prefix_ratio >= 0.68 and prefix_similarity >= 0.80)
    ):
        raise RuntimeError(f"v2 echoed the user's question instead of answering: {answer[:180]!r}")
    last_word = (actual.split() or [""])[-1]
    if last_word in {"نموذ", "الادوا", "المتوف", "المتاح", "استدعا", "include", "includ", "availab", "capabilit"}:
        raise RuntimeError(f"v2 answer appears cut off mid-word: {answer[-120:]!r}")
    if len(answer) > 180 and not re.search(r"[.!؟?…؛:]$", answer.strip()):
        raise RuntimeError(f"v2 long answer lacks a sentence ending and may be truncated: {answer[-120:]!r}")
    stock_identity = re.search(r"(?:انا شام|شام مساعد ذكي|مساعد ذكي صنعه فريقنا)", actual[:90])
    if stock_identity:
        raise RuntimeError(f"v2 started with its stock identity instead of answering the capability question: {answer[:180]!r}")
    ability = re.search(
        r"(?:استطيع|يمكنني|اقدر|لدي خبرة|عندي خبرة|اجيد|اعرف|خبرتي|برمج|كود|تصحيح|كتابة|مساعدة|مساعدتك|تطوير)",
        actual,
    )
    if not ability:
        raise RuntimeError(f"v2 did not state a concrete capability: {answer[:180]!r}")


def main() -> int:
    if not TOKEN:
        raise RuntimeError("MODELSCOPE_TOKEN is missing")
    if "sham-v1" in BASE.lower() or "nova-inference-server" in BASE.lower() or "coder-inference" in BASE.lower():
        raise RuntimeError("Refusing to test a non-primary-v2 Studio URL")
    if "sham-v2-server" not in BASE.lower():
        raise RuntimeError("Refusing to test anything except Sham v2's dedicated primary Studio")

    status = None
    deadline = time.time() + 300
    while time.time() < deadline:
        status = call("status", {}, timeout=30)
        if isinstance(status, str):
            try:
                status = json.loads(status)
            except json.JSONDecodeError:
                status = {}
        if isinstance(status, dict) and status.get("phase") == "ready":
            break
        time.sleep(5)
    if not isinstance(status, dict) or status.get("phase") != "ready":
        raise RuntimeError(f"Sham v2's own Studio is not ready: {json.dumps(status, ensure_ascii=False)[:500]}")
    if status.get("model") != EXPECTED_MODEL:
        raise RuntimeError(f"Wrong model in v2 Studio: {status.get('model')!r}, expected {EXPECTED_MODEL!r}")

    last = None
    for attempt in range(3):
        last = call("generate_any", {"prompt": QUESTION, "max_new_tokens": 320}, timeout=240)
        if isinstance(last, str):
            try:
                last = json.loads(last)
            except json.JSONDecodeError:
                last = {"type": "text", "text": last}
        if isinstance(last, dict) and last.get("type") == "busy":
            time.sleep(5)
            continue
        break
    if not isinstance(last, dict) or last.get("type") != "text":
        raise RuntimeError(f"Expected a text answer from Sham v2's own generate_any path; got {str(last)[:300]!r}")
    answer = str(last.get("text") or "").strip()
    check_answer(answer)
    print(f"PASS Sham v2 capability answer: {answer[:500]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
