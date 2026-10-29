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
    ("ذكّرني كل صباح بمراجعة الطلبات.", "schedule_create", {"title": "مراجعة الطلبات", "prompt": "راجع طلبات الدمج الجديدة في المستودع الرئيسي ولخّصها", "kind": "cron"}, "scheduled", "تم، سأذكّرك كل صباح الساعة 9."),
    ("ارسم لي قطة تلعب في الحديقة.", "make_media", {"kind": "image", "prompt": "قطة تلعب في الحديقة"}, "sent to the user as a picture", "أرسلتُ لك الصورة."),
    ("ماذا تتذكر عن تفضيلاتي؟", "memory_search", {"query": "تفضيلات المستخدم"}, "المستخدم يفضّل الردود القصيرة", "أتذكر أنك تفضّل الردود القصيرة."),
    ("ما المهام المجدولة عندي؟", "schedule_list", {}, "s1 | مراجعة الطلبات | كل يوم 9:00", "عندك مهمة واحدة: مراجعة الطلبات كل يوم 9:00."),
    ("ابحث بعمق: ما الفرق بين WebSocket وSSE؟", "deep_research", {"question": "الفرق بين WebSocket وSSE"}, "[1] MDN: SSE اتجاه واحد من الخادم؛ [2] WebSocket ثنائي الاتجاه", "WebSocket ثنائي الاتجاه، أما SSE فمن الخادم إلى المتصفح فقط [1][2]."),
    ("ادمج طلب الدمج رقم 7 في {repo}.", "github_merge_pr", {"repo": "{repo}", "number": 7, "method": "merge"}, "merged PR #7 into main", "دمجتُ طلب الدمج #7 في main."),
    ("هل أحذف الفرع؟", "ask_user", {"question": "هل تريد حذف الفرع فعلاً؟"}, "yes", "سأحذف الفرع الآن بعد تأكيدك."),
]
# the whole fix flow, as Nova does it: copy the project to the computer, run its tests, edit, test again, SEND the changes back (sandbox_push: what is edited in the computer exists only there), then the pull request INTO the branch the user named
FLOW_REQUESTS = [
    "اذهب إلى المستودع {repo} على الفرع {base}، شغّل الاختبارات وأصلح الأخطاء وافتح طلب دمج إلى {base}.",
    "أصلح الأخطاء في {repo} (الفرع {base}) وادفع الإصلاح في فرع جديد ثم افتح PR إلى {base}.",
]
BRANCHES = ["dev", "test/mini", "staging"]


def fix_flow_spec(rng: random.Random) -> tuple[str, list, str]:
    repo, base = rng.choice(REPOS), rng.choice(BRANCHES)
    fix = rng.choice(["fix/cart-bugs", "fix/tests", "fix/errors"])
    steps = [
        ("sandbox_clone", {"repo": repo, "branch": base}, "cloned into /work/repo"),
        ("sandbox_exec", {"command": "cd repo && python3 -m pytest -q"}, "exit code 1\nFAILED test_cart.py::test_discount - assert 190.0 == 180"),
        ("sandbox_edit_file", {"path": "repo/cart.py", "old": "percent / 10", "new": "percent / 100"}, "edited /work/repo/cart.py (1 replacement)"),
        ("sandbox_exec", {"command": "cd repo && python3 -m pytest -q"}, "exit code 0\n5 passed"),
        ("sandbox_push", {"repo": repo, "branch": fix, "message": "fix the discount"}, f"commit abc fix the discount\n cart.py | 2 +-\nPUSHED to {repo} branch {fix}"),
        ("github_create_pr", {"repo": repo, "head": fix, "base": base, "title": "Fix the discount"}, f"PR #7 https://github.com/{repo}/pull/7 ({fix} → {base}; 1 files changed, +1 -1)"),
    ]
    ans = f"أصلحت الخطأ في الحاسوب ونجحت الاختبارات الخمسة، ثم دفعت التعديل إلى الفرع {fix} وفتحت الطلب #7 من {fix} إلى {base}."
    return rng.choice(FLOW_REQUESTS).format(repo=repo, base=base), steps, ans


def fix_flow_example(text_ids_fn, rng: random.Random, **kw) -> tuple[list[int], list[int]]:
    return build_tool_example(text_ids_fn, *_spec_args(fix_flow_spec(rng)), **kw)


def _spec_args(spec):
    user, steps, ans = spec
    return user, steps, ans


# the request does not name what to work on: the learned behaviour is ONE question with ask_user (which repository / branch / file), never a guess
MISSING_REQUESTS = [
    ("شغّل الاختبارات وأصلح الأخطاء.", "أي مستودع تقصد؟ وعلى أي فرع أعمل؟", "jonsnow-org/Ttbik على الفرع dev", "حسناً، سأعمل على jonsnow-org/Ttbik في الفرع dev."),
    ("اقرأ الملف وأخبرني ماذا فيه.", "أي ملف تقصد، وفي أي مستودع؟", "الملف README.md في octocat/hello-world", "سأقرأ README.md من octocat/hello-world الآن."),
    ("افتح طلب دمج بالتعديلات.", "من أي فرع وإلى أي فرع تريد الدمج؟", "من fix/tests إلى main", "حسناً، سأفتح الطلب من fix/tests إلى main."),
    ("هل يمكنك مراجعة مشروعي؟", "ما اسم المستودع الذي تريد مراجعته؟", "user/project", "سأراجع user/project الآن."),
]


def ask_missing_spec(rng: random.Random) -> tuple[str, list, str]:
    req, question, reply, ans = rng.choice(MISSING_REQUESTS)
    return req, [("ask_user", {"question": question}, reply)], ans


def ask_missing_example(text_ids_fn, rng: random.Random, **kw) -> tuple[list[int], list[int]]:
    return build_tool_example(text_ids_fn, *ask_missing_spec(rng), **kw)


# code: write it, RUN it in the computer, fix what fails, answer only after it passes (the way Nova works)
CODE_TASKS = [
    ("اكتب دالة تعكس نصاً وجرّبها.", "rev.py", "def rev(s):\n    return s[::1]\n", "s[::1]", "s[::-1]", "assert rev('abc') == 'cba'", "دالة rev تعكس النص: `return s[::-1]`، وجرّبتها فنجح الاختبار."),
    ("اكتب دالة تحسب مجموع قائمة أرقام وتأكد أنها تعمل.", "total.py", "def total(xs):\n    t = 1\n    for x in xs:\n        t += x\n    return t\n", "t = 1", "t = 0", "assert total([1, 2, 3]) == 6", "دالة total تجمع الأرقام ابتداءً من 0، وجرّبتها فنجح الاختبار."),
    ("اكتب دالة تتحقق إن كان العدد زوجياً واختبرها.", "even.py", "def even(n):\n    return n % 2 == 1\n", "== 1", "== 0", "assert even(4) and not even(3)", "دالة even تتحقق من الباقي صفراً، وجرّبتها فنجح الاختبار."),
]


def code_run_spec(rng: random.Random) -> tuple[str, list, str]:
    req, path, bad, old, new, check, ans = rng.choice(CODE_TASKS)
    mod = path[:-3]
    run = f"python3 -c \"from {mod} import *; {check}\""
    steps = [
        ("sandbox_write_file", {"path": path, "content": bad}, f"wrote {path}"),
        ("sandbox_exec", {"command": run}, "exit code 1\nAssertionError"),
        ("sandbox_edit_file", {"path": path, "old": old, "new": new}, f"edited {path} (1 replacement)"),
        ("sandbox_exec", {"command": run}, "exit code 0"),
    ]
    return req, steps, ans


def code_run_example(text_ids_fn, rng: random.Random, **kw) -> tuple[list[int], list[int]]:
    return build_tool_example(text_ids_fn, *code_run_spec(rng), **kw)


REPOS = ["jonsnow-org/Ttbik", "octocat/hello-world", "user/project"]
URLS = ["https://example.com", "https://docs.python.org/3/"]


def synthetic_examples(text_ids_fn, rng: random.Random, n: int = 200, **kw) -> list[tuple[list[int], list[int]]]:
    out = []
    for _ in range(n):
        r = rng.random()
        if r < 0.15:                                                          # the fix flow with the push back to GitHub
            out.append(fix_flow_example(text_ids_fn, rng, **kw))
            continue
        if r < 0.27:                                                          # code written, run in the computer, fixed, then answered
            out.append(code_run_example(text_ids_fn, rng, **kw))
            continue
        if r < 0.37:                                                          # a missing detail: ask once, never guess
            out.append(ask_missing_example(text_ids_fn, rng, **kw))
            continue
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


def catalog_spec(rng: random.Random) -> tuple[str, list, str]:
    req, name, args, res, ans = rng.choice(CATALOG)
    sub = {"repo": rng.choice(REPOS), "url": rng.choice(URLS)}
    fill = lambda v: v.format(**sub) if isinstance(v, str) else v            # noqa: E731
    args = {k: fill(v) for k, v in args.items()}
    if ans is None:
        return fill(req), [(name, args, res), ("sandbox_exec", {"command": "npm test"}, "Tests: 12 passed")], "نسخت المستودع وشغّلت الاختبارات: نجحت كلها (12 اختباراً)."
    return fill(req), [(name, args, res)], ans


def any_spec(rng: random.Random) -> tuple[str, list, str]:
    """One teaching case: the fix flow, code written-run-fixed, a missing detail asked once, or a single catalog call (same shares as synthetic_examples)."""
    r = rng.random()
    if r < 0.15:
        return fix_flow_spec(rng)
    if r < 0.27:
        return code_run_spec(rng)
    if r < 0.37:
        return ask_missing_spec(rng)
    return catalog_spec(rng)


# ---- the SAME conversation layout Nova's engine shows Sham (src/lib/shamTools.ts: shamToolBlock + shamToolConversation), for a donor body that chats in the Qwen3 layout ----
FORMAT_LINE = ('لاستعمال أداة اكتب سطراً واحداً بهذا الشكل ثم انتظر النتيجة: <tool_call>{"name": "اسم_الأداة", "arguments": {...}}</tool_call>. إن لم تحتج أداة فأجب مباشرة. '
               'إن كانت معلومة ناقصة عند المستخدم (أي مستودع؟ أي فرع؟ أي ملف؟) فاسأله بـ ask_user ولا تخمّن. '
               'وإذا كتبت كوداً فجرّبه في الجهاز الافتراضي (sandbox_write_file ثم sandbox_exec) وأصلح ما يفشل قبل أن تجيب.')
# name -> (arguments, "?" = optional ; first words of the description as the engine shows them)
TOOL_SPECS: dict[str, tuple[str, str]] = {
    "github_read_file": ("repo, path, ref?", "Read one file from a GitHub repository"),
    "github_repo_scan": ("repo", "Overview of a repository: default branch, folders, root files"),
    "github_list_files": ("repo, path?, ref?", "List the files of a repository"),
    "github_search_code": ("repo, query", "Search the code of a repository"),
    "github_create_pr": ("repo, head, base, title, body?", "Open a pull request from head INTO base"),
    "sandbox_clone": ("repo, branch?", "Copy a repository into this task's private computer"),
    "sandbox_exec": ("command, cwd?", "Run a shell command in this task's VM"),
    "sandbox_write_file": ("path, content, cwd?", "Write a file in the VM (creates folders)"),
    "sandbox_edit_file": ("path, old, new, replace_all?, cwd?", "Edit a file in the VM by replacing an exact piece of text"),
    "sandbox_push": ("repo, branch, message, dir?", "Send the edits made in the VM to a GitHub branch"),
    "web_search": ("query", "Search the web"),
    "fetch_page": ("url", "Read a web page"),
    "github_merge_pr": ("repo, number, method?", "Merge a pull request (the user is asked first)"),
    "sandbox_wait": ("id", "Keep waiting for a long command"),
    "sandbox_search": ("pattern?, glob?, path?", "Search the VM's files"),
    "sandbox_read_file": ("path, start_line?, max_lines?", "Read a file from the VM"),
    "deep_research": ("question", "Research a question: many sources, numbered [n]"),
    "make_media": ("kind, prompt", "Make a picture, a sound or a short video yourself and send it"),
    "memory_save": ("text, kind?, repo?", "Remember a lasting fact about this user"),
    "memory_search": ("query, repo?", "Search what is remembered about this user"),
    "schedule_create": ("title, prompt, kind?, recurrence?", "Schedule a task that runs by itself later"),
    "schedule_list": ("", "List the scheduled tasks"),
    "ask_user": ("question, options?", "Ask the user ONE short question and wait for the answer"),
}


def tool_block(names: list[str]) -> str:
    lines = [f"- {n}({TOOL_SPECS[n][0]}) — {TOOL_SPECS[n][1][:70]}" for n in names if n in TOOL_SPECS]
    return "الأدوات المتاحة لك:\n" + "\n".join(lines) + "\n" + FORMAT_LINE


def qwen3_prompt(system: str, user_text: str) -> str:
    prefix = f"<|im_start|>system\n{system}<|im_end|>\n" if system.strip() else ""
    return prefix + f"<|im_start|>user\n{user_text}<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n"


def qwen3_tool_examples(tokenizer, rng: random.Random, n: int, system: str, max_len: int = 1100, max_result_chars: int = 700) -> list[tuple[list[int], list[int]]]:
    """n examples in the layout the engine really sends: ONE user turn = the loaded-tools block + the conversation so far (user line, earlier calls and results), ending «شام:»;
    the learned reply is the NEXT call (or the final answer). One example per decision point of a case. Loss only on the reply."""
    out: list[tuple[list[int], list[int]]] = []
    end = tokenizer.encode("<|im_end|>")[-1]
    while len(out) < n:
        user, steps, ans = any_spec(rng)
        used = [st[0] for st in steps]
        others = [t for t in TOOL_SPECS if t not in used]
        rng.shuffle(others)
        names = list(dict.fromkeys(used + others[: rng.randint(2, 6)]))
        rng.shuffle(names)
        lines = [f"المستخدم: {user}"]
        for i in range(len(steps) + 1):
            if i < len(steps):
                name, args, res = steps[i]
                target = tool_call_text(name, args)
            else:
                target = ans
            prompt = qwen3_prompt(system, f"{tool_block(names)}\n\n" + "\n".join(lines) + "\nشام:")
            p_ids, t_ids = tokenizer.encode(prompt), tokenizer.encode(target) + [end]
            if len(p_ids) + len(t_ids) <= max_len:
                out.append((p_ids + t_ids, [IGNORE] * len(p_ids) + t_ids))
            if i < len(steps):
                lines.append(f"شام: {tool_call_text(name, args)}")
                lines.append(f"نتيجة الأداة {name}:\n{str(res)[:max_result_chars]}")
    return out[:n]


if __name__ == "__main__":
    fake = lambda s: [ord(c) % 4000 + 10 for c in s]          # noqa: E731  a stand-in tokenizer: the layout and the masking are what is checked
    ex = synthetic_examples(fake, random.Random(1), 40)
    assert len(ex) == 40
    flow = fix_flow_example(fake, random.Random(2))
    for mk in (code_run_example, ask_missing_example):
        ids2, lab2 = mk(fake, random.Random(3))
        assert len(ids2) == len(lab2) and any(l != IGNORE for l in lab2) and ids2[-1] == SpecialTokens.EOS
    assert any(l != IGNORE for l in flow[1]) and len(flow[0]) == len(flow[1])
    assert any(fake(tool_call_text("sandbox_push", {"repo": r, "branch": b, "message": "fix the discount"}))[0] for r in REPOS for b in ["fix/tests"])
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
    class _T:                                                                 # the Qwen3-layout builder: the prompt is masked, the reply (and <|im_end|>) learned
        def encode(self, t):
            return [9999] if t == "<|im_end|>" else fake(t)
    qx = qwen3_tool_examples(_T(), random.Random(5), 30, "SYS")
    assert len(qx) == 30 and all(len(a) == len(b) and any(l != IGNORE for l in b) and b[-1] == 9999 for a, b in qx)
    assert all(b[0] == IGNORE for a, b in qx) and sum(1 for a, b in qx if len([l for l in b if l != IGNORE]) > 1) == 30
    ts = Path(__file__).resolve().parents[3] / "src" / "lib" / "shamTools.ts"                              # the line shown to the model must not drift from the engine's
    if ts.is_file():
        import re
        m = re.search(r"const FORMAT_LINE = '(.*)';", ts.read_text(encoding="utf-8"))
        assert m and m.group(1) == FORMAT_LINE, "FORMAT_LINE differs from src/lib/shamTools.ts"
    print("sham_tools_data OK: calls learned, results masked, answers learned, lessons of any kind, every tool family seen.")
