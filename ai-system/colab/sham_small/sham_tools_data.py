"""
Sham — teaching data for ALL of Nova's tools (GitHub, the private VM / terminal, web, memory, schedules, sub-agents, connectors), so that a trained Sham can
use them through Nova's engine (src/lib/shamTools.ts). Same idea and masking as sham_agent_data.py, but for any tool:

  the user's request -> <tool_call>{"name": ..., "arguments": {...}}</tool_call> (learned) -> the tool's result (masked: it comes from the tool at inference)
  -> [more calls] -> the final answer (learned).

No new special tokens (the live model's vocabulary is fixed): the call is plain text, written exactly as shamTools.ts reads it. Two sources:
  examples_from_lessons(): the owner's Nova lessons (coder_lessons export, JSON Lines) of ANY kind — real tool use by a bigger model, secrets already dropped there;
  synthetic_examples():    short, correct calls for each tool family (so every tool is seen even before enough lessons exist).
Share of these in a training mix: SHAM_TOOLS_MIX (0..1, default 0 = off until the owner turns it on). Nothing here runs at inference as an answer rule.
"""

from __future__ import annotations

import json
import os
import random
from pathlib import Path

from model import SpecialTokens
from sham_decoding import SHAM_TURN, USER_TURN

IGNORE = -100


def mix_share() -> float:
    try:
        return min(1.0, max(0.0, float(os.environ.get("SHAM_TOOLS_MIX", "0"))))
    except ValueError:
        return 0.0


def tool_call_text(name: str, arguments: dict | str) -> str:
    """The one spelling of a call (must stay identical to shamTools.ts shamToolConversation)."""
    args = arguments if isinstance(arguments, str) else json.dumps(arguments, ensure_ascii=False)
    return f'<tool_call>{{"name": "{name}", "arguments": {args or "{}"}}}</tool_call>'


def result_text(name: str, result: str) -> str:
    return f"\nنتيجة الأداة {name}:\n{result}\nشام:"


def build_tool_example(text_ids_fn, user: str, steps: list[tuple[str, dict | str, str]], answer: str, max_result_tokens: int = 200,
                       max_answer_tokens: int = 120, date_line: str | None = None) -> tuple[list[int], list[int]]:
    """steps = [(tool name, arguments, result text), ...]. Calls and the answer are learned; results are masked."""
    prefix = [SpecialTokens.BOS, USER_TURN] + text_ids_fn((date_line + "\n" if date_line else "") + user) + [SHAM_TURN]
    ids, labels = list(prefix), [IGNORE] * len(prefix)
    for name, args, result in steps:
        call = text_ids_fn(tool_call_text(name, args))
        back = text_ids_fn(result_text(name, result))[:max_result_tokens]
        ids += call + back
        labels += call + [IGNORE] * len(back)
    ans = text_ids_fn(answer)[:max_answer_tokens]
    return ids + ans + [SpecialTokens.EOS], labels + ans + [SpecialTokens.EOS]


def examples_from_lessons(path: str | Path, text_ids_fn, limit: int = 2000, max_steps: int = 3, **kw) -> list[tuple[list[int], list[int]]]:
    out: list[tuple[list[int], list[int]]] = []
    p = Path(path)
    if not p.is_file():
        return out
    for line in p.read_text(encoding="utf-8").splitlines():
        if len(out) >= limit:
            break
        try:
            msgs = json.loads(line).get("messages") or []
        except ValueError:
            continue
        user = next((m for m in msgs if m.get("role") == "user" and str(m.get("content", "")).strip()), None)
        final = next((m for m in reversed(msgs) if m.get("role") == "assistant" and not m.get("tool_calls") and len(str(m.get("content", "")).strip()) >= 20), None)
        if not (user and final):
            continue
        results = {m.get("tool_call_id"): str(m.get("content", "")) for m in msgs if m.get("role") == "tool"}
        steps: list[tuple[str, dict | str, str]] = []
        for m in msgs:
            for c in m.get("tool_calls") or []:
                f = c.get("function") or {}
                res = results.get(c.get("id"))
                if f.get("name") and res is not None and len(steps) < max_steps:
                    steps.append((f["name"], f.get("arguments") or "{}", res[:1500]))
        if steps:
            out.append(build_tool_example(text_ids_fn, str(user["content"])[:700], steps, str(final["content"]).strip()[:600], **kw))
    return out


# (request, tool, arguments, a typical short result, the answer)
CATALOG = [
    ("اقرأ ملف README في {repo}.", "github_read_file", {"repo": "{repo}", "path": "README.md"}, "README.md (40 lines)\n1| # المشروع\n2| أداة لإدارة المهام.", "الملف يقول إن المشروع أداة لإدارة المهام."),
    ("أعطني نظرة سريعة على المستودع {repo}.", "github_repo_scan", {"repo": "{repo}"}, "default branch main\nfolders: src, docs\nroot files: package.json, README.md", "المستودع فرعه الرئيسي main، وفيه مجلدا src وdocs وملف package.json."),
    ("ما الملفات الموجودة في {repo}؟", "github_list_files", {"repo": "{repo}"}, "12 files\nREADME.md\nsrc/app.ts", "فيه 12 ملفاً، منها README.md وsrc/app.ts."),
    ("ابحث في {repo} عن الدالة login.", "github_search_code", {"repo": "{repo}", "query": "login"}, "src/auth.ts\nsrc/routes.ts", "وجدت login في src/auth.ts وsrc/routes.ts."),
    ("شغّل الاختبارات في المستودع {repo}.", "sandbox_clone", {"repo": "{repo}"}, "cloned to /work/repo", None),
    ("اعرض محتوى المجلد الحالي في الجهاز.", "sandbox_exec", {"command": "ls"}, "app.py\nREADME.md\ntests", "في المجلد app.py وREADME.md ومجلد tests."),
    ("ابحث عن آخر إصدار من Python.", "web_search", {"query": "latest Python release"}, "Python 3.14 released ...", "آخر إصدار وجدته هو Python 3.14."),
    ("اقرأ هذه الصفحة: {url}", "fetch_page", {"url": "{url}"}, "Example Domain. This domain is for use in examples.", "الصفحة مخصصة لأمثلة التوثيق."),
    ("تذكّر أنني أفضّل الردود القصيرة.", "memory_save", {"text": "المستخدم يفضّل الردود القصيرة"}, "saved", "حفظتُ ذلك، سأجعل ردودي قصيرة."),
    ("ذكّرني كل صباح بمراجعة الطلبات.", "schedule_create", {"title": "مراجعة الطلبات", "when": "كل يوم 9:00"}, "scheduled", "تم، سأذكّرك كل صباح الساعة 9."),
    ("نفّذ هذه الأعمال المستقلة معاً: قراءة ملفين.", "delegate", {"tasks": [{"title": "قراءة أ", "task": "اقرأ a"}, {"title": "قراءة ب", "task": "اقرأ b"}]}, "2 agents finished", "انتهى الوكيلان من قراءة الملفين."),
    ("هل أحذف الفرع؟", "ask_user", {"question": "هل تريد حذف الفرع فعلاً؟"}, "yes", "سأحذف الفرع الآن بعد تأكيدك."),
    ("أحتاج أدوات الجهاز الافتراضي.", "load_tools", {"groups": ["computer"]}, "loaded: computer", "تم تحميل أدوات الجهاز."),
]
REPOS = ["jonsnow-org/Ttbik", "octocat/hello-world", "user/project"]
URLS = ["https://example.com", "https://docs.python.org/3/"]


def synthetic_examples(text_ids_fn, rng: random.Random, n: int = 200, **kw) -> list[tuple[list[int], list[int]]]:
    out = []
    for _ in range(n):
        req, name, args, res, ans = rng.choice(CATALOG)
        sub = {"repo": rng.choice(REPOS), "url": rng.choice(URLS)}
        fill = lambda v: v.format(**sub) if isinstance(v, str) else v        # noqa: E731
        args = {k: fill(v) for k, v in args.items()}
        if ans is None:                                                       # a two-step example: clone, then run
            steps = [(name, args, res), ("sandbox_exec", {"command": "npm test"}, "Tests: 12 passed")]
            ans = "نسخت المستودع وشغّلت الاختبارات: نجحت كلها (12 اختباراً)."
        else:
            steps = [(name, args, res)]
        out.append(build_tool_example(text_ids_fn, fill(req), steps, ans, **kw))
    return out


if __name__ == "__main__":
    fake = lambda s: [ord(c) % 4000 + 10 for c in s]          # noqa: E731  a stand-in tokenizer: the layout and the masking are what is checked
    ex = synthetic_examples(fake, random.Random(1), 40)
    assert len(ex) == 40
    for ids, labels in ex:
        assert len(ids) == len(labels) and ids[-1] == SpecialTokens.EOS and labels[-1] == SpecialTokens.EOS
        assert labels[0] == IGNORE and any(l != IGNORE for l in labels)
    ids, labels = build_tool_example(fake, "سؤال", [("web_search", {"query": "x"}, "RESULT-TEXT")], "جواب")
    call = fake(tool_call_text("web_search", {"query": "x"})); res = fake(result_text("web_search", "RESULT-TEXT"))
    start = ids.index(call[0], 3)
    assert ids[start:start + len(call)] == call and labels[start:start + len(call)] == call              # the call is learned
    r0 = start + len(call)
    assert ids[r0:r0 + len(res)] == res and all(l == IGNORE for l in labels[r0:r0 + len(res)])           # the result is masked
    assert labels[-len(fake("جواب")) - 1:-1] == fake("جواب")                                             # the answer is learned
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        f = Path(d) / "l.jsonl"
        f.write_text(json.dumps({"messages": [{"role": "user", "content": "اقرأ a"}, {"role": "assistant", "content": "", "tool_calls": [{"id": "1", "function": {"name": "github_read_file", "arguments": "{\"repo\":\"o/r\",\"path\":\"a\"}"}}]},
                                                {"role": "tool", "tool_call_id": "1", "content": "1| hello"}, {"role": "assistant", "content": "الملف فيه كلمة hello فقط."}]}) + "\n", encoding="utf-8")
        got = examples_from_lessons(f, fake)
        assert len(got) == 1 and any(l != IGNORE for l in got[0][1])
    print("sham_tools_data OK: calls learned, results masked, answers learned, lessons of any kind, every tool family seen.")
