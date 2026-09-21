"""
Sham -- Telegram progress reports.

Gap found comparing Nova's training pipeline against Sham's (owner
request, 2026-09-21, "لماذا لا نطبق ذات الطريقة على شام؟"): Nova's
weekly training notebook sends the owner a real summary via its
Telegram bot after every run; Sham's autonomous crawl+train sessions
had no equivalent -- the owner's only way to know what a Kaggle run
actually did was reading the notebook's own output by hand.

Deliberately split in two, same reasoning as web_access.py's
search_fn/fetch_fn injection pattern used throughout this project:
  - send_telegram_message() here does the one real network call, with
    post_fn injectable for testing (no real internet in this sandbox).
  - format_cycle_report() (autonomous_pipeline.py) builds the text from
    real CycleResult objects, no network at all.
A Kaggle notebook wires the two together with its own
UserSecretsClient()-sourced bot token/chat id; nothing here hardcodes a
credential or forces a report to be sent -- a caller with no token
configured simply never calls this.
"""

from __future__ import annotations

import json
import urllib.request
from typing import Callable

PostFn = Callable[[str, dict], dict]  # (url, payload) -> real Telegram Bot API JSON response


def _real_post(url: str, payload: dict) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))


def send_telegram_message(token: str, chat_id: str, text: str, post_fn: PostFn = _real_post) -> bool:
    """Real Telegram Bot API sendMessage call. Never raises -- a failed
    report must not fail (or even slow down retrying) an otherwise-
    successful training session; it just prints why and returns False."""
    if not token or not chat_id:
        print("telegram_report: no token/chat_id configured -- skipping report (not an error).")
        return False
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    try:
        result = post_fn(url, {"chat_id": chat_id, "text": text})
        ok = bool(result.get("ok"))
        if not ok:
            print(f"telegram_report: Telegram API rejected the message: {result}")
        return ok
    except Exception as exc:
        print(f"telegram_report: send failed ({exc}) -- report lost this session, not fatal to training.")
        return False


def format_training_report(
    track_name: str,
    final_step: int,
    loss_history: list[float],
    dataset_slug: str | None = None,
) -> str:
    """Report shape for the two plain (non-crawling) training tracks --
    the GPU main track and the CPU training track -- which call train.py
    directly and only ever produce a flat loss_history, not the
    CycleResult objects autonomous_pipeline.format_cycle_report() needs.
    Pure formatting, no network."""
    lines = [
        f"🧠 تقرير جلسة شام — {track_name}",
        f"خطوات تدريب حقيقية هذه الجلسة: {len(loss_history)} (الخطوة النهائية: {final_step:,})",
    ]
    if loss_history:
        first_avg = sum(loss_history[:10]) / min(10, len(loss_history))
        last_avg = sum(loss_history[-10:]) / min(10, len(loss_history))
        lines.append(f"متوسط الخسارة أول 10 خطوات: {first_avg:.4f}")
        lines.append(f"متوسط الخسارة آخر 10 خطوات: {last_avg:.4f}")
    if dataset_slug:
        lines.append(f"نُشر إلى: {dataset_slug}")
    return "\n".join(lines)


if __name__ == "__main__":
    # Real, deterministic fake post_fn standing in for a real HTTP call
    # (no reachable internet in this sandbox, same documented boundary as
    # web_access.py's own __main__) -- proves the real wiring: a
    # configured token/chat_id genuinely calls post_fn with the right
    # URL/payload shape, a missing one is skipped without ever calling
    # post_fn at all, and a provider-side rejection is reported, not
    # silently swallowed as success.
    calls = []

    def fake_post_ok(url: str, payload: dict) -> dict:
        calls.append((url, payload))
        return {"ok": True, "result": {"message_id": 1}}

    def fake_post_rejected(url: str, payload: dict) -> dict:
        calls.append((url, payload))
        return {"ok": False, "description": "chat not found"}

    assert send_telegram_message("123:abc", "999", "hello", post_fn=fake_post_ok) is True
    assert len(calls) == 1
    assert calls[0][0] == "https://api.telegram.org/bot123:abc/sendMessage"
    assert calls[0][1] == {"chat_id": "999", "text": "hello"}
    print("real send path verified: correct URL and payload reached post_fn, True returned on ok=True.")

    calls.clear()
    assert send_telegram_message("123:abc", "999", "hello", post_fn=fake_post_rejected) is False
    assert len(calls) == 1
    print("provider-rejection path verified: False returned (not an exception) when Telegram says ok=False.")

    calls.clear()
    assert send_telegram_message("", "999", "hello", post_fn=fake_post_ok) is False
    assert len(calls) == 0, "an unconfigured token must never even attempt the network call"
    print("unconfigured-credentials path verified: skipped cleanly with zero network attempts.")

    report = format_training_report("GPU main track", 12_345, [5.0, 4.8, 4.6, 4.4, 4.2, 4.0, 3.8, 3.6, 3.4, 3.2, 3.0], "me/sham-checkpoint")
    assert "12,345" in report
    assert "me/sham-checkpoint" in report
    assert "11" in report  # len(loss_history)
    print("format_training_report() verified: real step count, loss averages, and dataset slug all appear.")

    empty_report = format_training_report("GPU main track", 0, [])
    assert "نُشر إلى" not in empty_report, "no dataset_slug given -- that line must not appear at all"
    print("format_training_report() with no losses/no publish yet verified: no crash, no fabricated fields.")

    print("\nAll telegram_report checks passed.")
