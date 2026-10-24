"""The owner's real Nova runs (coder_lessons, published by .github/workflows/nova-publish-lessons.yml to a PRIVATE Hugging Face dataset as
data/lessons.jsonl) as training rows, in the bot's real shape: the real system prompt first, only the tools the run used, arguments as JSON strings.

A lesson is one finished, successful run of the owner (secret-looking text already dropped the whole run when it was recorded; tool results were
shortened to 1,500 characters). Only research / tool-use lessons are kept, with a final answer of at least 200 characters. Rows that are too long
for the training context are dropped later by build_mix --max-len. Nothing leaves the owner's account: the dataset is private.

    python scripts/lessons_to_rows.py lessons.jsonl --out data/nova_lessons.jsonl
    python scripts/lessons_to_rows.py --selfcheck
"""
import argparse
import json
import random
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
T = HERE / "tools"


def runtime():
    d = json.loads((T / "runtime_tools.json").read_text(encoding="utf-8"))
    by_name = {t["function"]["name"]: t for t in d["all"]}
    by_name.update({t["function"]["name"]: t for t in d["first_step"]})
    return by_name, (T / "runtime_system_ar.txt").read_text(encoding="utf-8")


def convert(lesson: dict, by_name: dict, system: str, rng: random.Random):
    if lesson.get("kind") not in ("research", "tools"):
        return None
    msgs, used = [], []
    for m in lesson.get("messages") or []:
        role = m.get("role")
        if role not in ("user", "assistant", "tool"):
            continue
        out = {"role": role, "content": m.get("content") or ""}
        if role == "assistant" and m.get("tool_calls"):
            calls = []
            for c in m["tool_calls"]:
                f = c.get("function") or {}
                a = f.get("arguments")
                if isinstance(a, dict):
                    a = json.dumps(a, ensure_ascii=False)
                try:
                    json.loads(a or "{}")
                except ValueError:
                    return None                      # a broken call is not a lesson
                calls.append({"id": c.get("id") or f"call_{rng.randint(100000, 999999)}", "type": "function", "function": {"name": f.get("name"), "arguments": a or "{}"}})
                used.append(f.get("name"))
            out["tool_calls"] = calls
        if role == "tool":
            out["tool_call_id"] = m.get("tool_call_id")
            out["name"] = m.get("name")
        msgs.append(out)
    last = next((m for m in reversed(msgs) if m["role"] == "assistant" and m["content"].strip()), None)
    if not last or len(last["content"].strip()) < 200 or not any(m["role"] == "user" and len(m["content"].strip()) >= 16 for m in msgs):
        return None
    day = f"2026-{rng.randint(10, 12):02d}-{rng.randint(1, 28):02d}"
    sys_msg = {"role": "system", "content": re.sub(r"Current date \(UTC\): \d{4}-\d{2}-\d{2}", f"Current date (UTC): {day}", system)}
    tools = [by_name[n] for n in dict.fromkeys(used) if n in by_name]
    row = {"messages": [sys_msg] + msgs, "source": "nova_lessons"}
    if tools:
        row["tools"] = tools
    return row


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("src", nargs="?")
    ap.add_argument("--out", default=str(HERE / "data" / "nova_lessons.jsonl"))
    ap.add_argument("--selfcheck", action="store_true")
    a = ap.parse_args()
    by_name, system = runtime()
    rng = random.Random(3407)
    if a.selfcheck:
        good = {"kind": "research", "run": "r1", "steps": 3, "messages": [
            {"role": "user", "content": "ابحث عن مشاريع بوتات تلجرام وحلل كيف تتعامل مع الرسائل الطويلة"},
            {"role": "assistant", "content": "", "tool_calls": [{"id": "1", "type": "function", "function": {"name": "deep_research", "arguments": "{\"question\": \"x\", \"queries\": [\"telegram bot\"]}"}}]},
            {"role": "tool", "tool_call_id": "1", "name": "deep_research", "content": "Sources read: 1/1\n[1] a/b — https://github.com/a/b\n  > splits at 4096"},
            {"role": "assistant", "content": "المشروع a/b [1] يقسّم الرسائل الطويلة عند 4096 حرفاً. " * 6}]}
        r = convert(good, by_name, system, rng)
        assert r and r["messages"][0]["role"] == "system" and r["tools"][0]["function"]["name"] == "deep_research" and r["source"] == "nova_lessons"
        assert convert({**good, "kind": "chat"}, by_name, system, rng) is None
        assert convert({**good, "messages": good["messages"][:1] + [{"role": "assistant", "content": "", "tool_calls": [{"function": {"name": "x", "arguments": "{bad"}}]}] + good["messages"][3:]}, by_name, system, rng) is None
        short = {**good, "messages": good["messages"][:3] + [{"role": "assistant", "content": "تم."}]}
        assert convert(short, by_name, system, rng) is None
        print("lessons_to_rows selfcheck OK")
        return
    n = kept = 0
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    with open(a.out, "w") as f:
        for line in Path(a.src).open():
            if not line.strip():
                continue
            n += 1
            try:
                r = convert(json.loads(line), by_name, system, rng)
            except ValueError:
                r = None
            if r:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
                kept += 1
    print(f"{kept} of {n} lessons kept -> {a.out}")


if __name__ == "__main__":
    main()
