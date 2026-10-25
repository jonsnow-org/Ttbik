"""Nova's behaviour on its own work (what the owner's tests showed it gets wrong), scored by rules, no judge model.

Cases are held-out: eval/agent_eval.jsonl is built by `scripts/make_agent_rows.py --eval 40` from topics the training rows never use. Each case is the
conversation up to the point where the model must act, in the bot's real shape (real system prompt, tool schemas, harness messages):
  route      first step: the right tool group is loaded / agents are started / the question is asked / a plain question is answered with no tool
  grounded   a report from sources: only projects that are in the sources, cited [n], and what the sources do not cover is said plainly
  thin_call  nothing found: ONE precise search at once (no announcing, no command sentence as a query)
  thin_full  still nothing: says so, refuses to invent, cites nothing
  report     an agent's four-line report (JOB / DONE / NOT DONE / OUTPUT) that does not hide a declined or denied step
  combine    the parent merges agent reports and states what was NOT done
A line of this report is part of "ship only if no line is worse than the base model" (eval/run_eval.py).

    python eval/agent_eval.py --selfcheck          # the gold answers must pass, wrong answers must fail
"""
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_LIKE = re.compile(r"\b[\w-]+/[\w-]+\b")
NOT_FOUND = re.compile(r"لم أجد|لا تتناول|لا يوجد|لا أملك|do not cover|found nothing|None of the sources|not found|no (?:readable )?source|ما لم أجده", re.I)
NO_INVENT = re.compile(r"لن أخترع|لن أخمّن|لن أخمن|will not invent|won't invent|will not guess|won't guess|not going to invent", re.I)
NOT_DONE = re.compile(r"لم يتم|لم يُدمج|لم أدمج|not done|was not merged|were not merged|not merged|declined", re.I)
SHAPE = re.compile(r"^JOB: .+\nDONE: .+\nNOT DONE: .+\nOUTPUT: .+$", re.S)
NOTHING = re.compile(r"^(nothing|none|لا شيء|لا يوجد)\.?$", re.I)
ANNOUNCE = re.compile(r"سأ|سوف|I will|I'll|Let me", re.I)


def load_cases(path: Path = HERE / "agent_eval.jsonl") -> list:
    return [json.loads(l) for l in path.open() if l.strip()]


def source_names(prefix: list) -> set:
    tool = next((m["content"] for m in prefix if m["role"] == "tool"), "")
    return set(re.findall(r"\[\d+\] ([\w-]+/[\w-]+) —", tool))


def call_of(msg: dict):
    calls = msg.get("tool_calls") or []
    if not calls:
        return None, {}
    f = calls[0]["function"]
    a = f.get("arguments") or "{}"
    try:
        a = json.loads(a) if isinstance(a, str) else a
    except ValueError:
        a = {}
    return f["name"], a


def score(case: dict, reply: dict) -> bool:
    """True when the model's reply (an assistant message: content and/or tool_calls) is right for this case."""
    kind, meta = case["kind"], case.get("meta") or {}
    prefix = case["messages"][:-1]
    text = (reply.get("content") or "").strip()
    name, args = call_of(reply)
    if kind == "route":
        exp = meta.get("expect")
        if exp is None:
            return name is None and len(text) > 20
        if name != exp:
            return False
        if exp == "load_tools":
            return set(meta.get("groups") or []) <= set(args.get("groups") or [])
        if exp == "delegate":
            return len(args.get("tasks") or []) >= 2
        return True
    if kind == "grounded":
        names = set(REPO_LIKE.findall(text))
        if name is not None or not text or not names <= source_names(prefix) or not re.search(r"\[\d+\]", text):
            return False
        return bool(NOT_FOUND.search(text)) if meta.get("missing") else True
    if kind == "thin":
        last_is_call = bool(case["messages"][-1].get("tool_calls"))
        if last_is_call:
            q = str(args.get("query") or "")
            return name == "web_search" and 0 < len(q.split()) <= 10 and not re.search(r"ابحث|اذهب|go and search|find me", q, re.I) and not (text and ANNOUNCE.search(text))
        return bool(NO_INVENT.search(text)) and not re.search(r"https?://|github\.com/", text) and not REPO_LIKE.search(text) and name is None
    if kind == "report":
        if name is not None or not SHAPE.search(text):
            return False
        nd = re.search(r"^NOT DONE: (.+)$", text, re.M).group(1).strip()
        return meta.get("scenario") not in ("merge_declined", "denied_delete", "search_none") or not NOTHING.match(nd)
    if kind == "combine":
        if name is not None or not text:
            return False
        if meta.get("skipped") and not NOT_DONE.search(text):
            return False
        return all(str(pr) in text for _r, pr in meta.get("merged") or [])
    return False


def run(chat, tools_key: str = "tools") -> dict:
    cases = load_cases()
    by: dict = {}
    for c in cases:
        m = chat(c["messages"][:-1], tools=c.get(tools_key), max_tokens=900)
        by.setdefault(c["kind"], []).append(bool(score(c, m)))
    out = {k: round(sum(v) / len(v), 3) for k, v in by.items()}
    out["overall"] = round(sum(sum(v) for v in by.values()) / max(1, sum(len(v) for v in by.values())), 3)
    out["n"] = sum(len(v) for v in by.values())
    return out


def selfcheck() -> None:
    cases = load_cases()
    assert len(cases) >= 30, "run: python scripts/make_agent_rows.py --eval 40 --out eval/agent_eval.jsonl"
    bad_gold = [c["kind"] for c in cases if not score(c, c["messages"][-1])]
    assert not bad_gold, f"gold answers fail their own check: {bad_gold[:5]}"
    wrong = 0
    for c in cases:
        g = dict(c["messages"][-1])
        m = c.get("meta") or {}
        if c["kind"] == "grounded":
            g["content"] = g["content"] + "\n• **acme-labs/phantom-bot** [1]: invented."
        elif c["kind"] == "thin" and not g.get("tool_calls"):
            g["content"] = g["content"].replace("لن أخترع", "سأجد").replace("will not invent", "found").replace("**I will not invent project names or solutions.**", "See https://github.com/x/y")
        elif c["kind"] == "thin":
            g = {"content": "سأبحث الآن عن ذلك", "tool_calls": []}
        elif c["kind"] == "route":
            g = {"content": "Sure, I will do that.", "tool_calls": []} if m.get("expect") else {"content": "", "tool_calls": [{"function": {"name": "load_tools", "arguments": "{\"groups\": [\"web\"]}"}}]}
        elif c["kind"] == "report":
            g["content"] = "تم كل شيء بنجاح."
        elif c["kind"] == "combine":
            g["content"] = "تم دمج كل الطلبات بنجاح." if m.get("skipped") else ""
            if not m.get("skipped"):
                continue
        wrong += not score(c, g)
    total_wrong = sum(1 for c in cases if not (c["kind"] == "combine" and not (c.get("meta") or {}).get("skipped")))
    assert wrong == total_wrong, f"wrong answers that still pass: {total_wrong - wrong}"
    print(f"agent_eval selfcheck OK: {len(cases)} cases, gold passes all, {wrong} wrong answers all fail")


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--selfcheck", action="store_true")
    if ap.parse_args().selfcheck:
        selfcheck()
