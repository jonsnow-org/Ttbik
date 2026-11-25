"""Sham Pro's agent-loop head on REAL requests (owner, 2026-11-25).

The live probe (2026-11-25, before this): on real prompts the head wrote garbage («python3 -c "pornt iu…"», «@� ooagءcub…») or "تعذّر عليّ تحديد أمر" for
«اعرض الملفات في المجلد الحالي على حاسوبك», because it was trained only on ~30 synthetic terminal tasks + templated episodes. Its gates (held-out on those
tasks) passed while real requests failed. This file is the real-request side of the recipe:

  1. live(path)      the model's OWN verified successful tool runs: the experience log (sham_tldm_experience, schema tldm.session_experience.v1) keeps
                     verified rows; only turns where EVERY command succeeded (success=true, verified=true, every step ok) are used. Redacted at write time.
  2. episodes(rng)   real-phrased requests (how users actually ask, Arabic MSA + dialect + English) mapped to commands that are EXECUTED on Sham Pro's own
                     computer while the data is built; a row is kept only if every command succeeded (the same "verified success" rule as the log).
  3. ACCEPT          held-out real prompts (other wordings, other arguments, and the exact probe prompts) with a checker: the acceptance test the new head
                     must pass on the real terminal before it is published.

No answer is written by hand where the computer can produce it: replies are templates filled with the real command output."""
from __future__ import annotations

import json
import random
import re
from pathlib import Path

UNFILLED = re.compile(r"@[TNFR]\d")
SCHEMA = "tldm.session_experience.v1"

# ---------------------------------------------------------------- 1. the model's own verified runs


def live(path) -> list[tuple[str, list, str]]:
    """-> [(task, [(cmd, out), ...], reply)] from the experience log: verified, successful, every step ok, no unfilled slot, de-duplicated."""
    p = Path(path) if path else None
    if not p or not p.is_file():
        return []
    out, seen = [], set()
    for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            r = json.loads(line)
        except Exception:
            continue
        if r.get("schema") != SCHEMA or not r.get("verified") or not r.get("success"):
            continue
        steps = [s for s in (r.get("steps") or []) if isinstance(s, (list, tuple)) and len(s) >= 2]
        if not steps or not all(bool(s[2]) if len(s) > 2 else True for s in steps):
            continue
        task, reply = str(r.get("task") or "").strip(), str(r.get("ref_reply") or "").strip()
        cmds = [str(s[0]) for s in steps]
        if not task or any(UNFILLED.search(c) for c in cmds) or UNFILLED.search(reply) or "[redacted]" in task:
            continue
        key = (task, tuple(cmds))
        if key in seen:
            continue
        seen.add(key)
        out.append((task, [(str(s[0]), str(s[1])) for s in steps], reply))
    return out


# ---------------------------------------------------------------- 2. real-phrased requests, executed


def _ar_where(rng):
    return rng.choice(["", " على حاسوبك", " في حاسوبك", " بالطرفية", " عندك"])


def _en_where(rng):
    return rng.choice(["", " on your computer", " on your machine", " in the terminal"])


_TOKENS = ["SHAM_READY", "READY_1", "TEST_OK", "PING_42", "DONE_7", "HELLO_SHAM", "CHECK_9", "ALPHA_OK"]
_FILES = ["memo.txt", "list.md", "plan.txt", "ideas.md", "draft.txt", "keep.txt", "items.md", "out1.txt"]
_FIX = ["app.log", "names.txt", "README.md"]


def _tok(rng):
    if rng.random() < 0.5:
        return rng.choice(_TOKENS)
    a = "".join(rng.choice("ABCDEFGHJKLMNPQRSTUVWXYZ") for _ in range(rng.randrange(2, 5)))
    return a + rng.choice(["_", "-"]) + str(rng.randrange(10, 9999))


def episode(rng: random.Random):
    """-> (task, plan, reply_template). plan = commands ({r0} = first result); replies are filled from the real outputs."""
    ar = rng.random() < 0.6
    k = rng.randrange(12)
    if k == 0:
        t = rng.choice(["اعرض الملفات في المجلد الحالي", "ما الملفات الموجودة", "شو في ملفات بالمجلد", "أرني الملفات", "اعرض قائمة الملفات"]) + _ar_where(rng) if ar else \
            rng.choice(["list the files in the current folder", "show me the files", "what files are there", "list everything in this directory"]) + _en_where(rng)
        return t, ["ls | head -n 8 | tr '\\n' ' '"], ("الملفات: {r0}" if ar else "Files: {r0}")
    if k == 1:
        t = rng.choice(["في أي مجلد أنت الآن", "اطبع المسار الحالي", "ما هو المجلد الحالي", "وين انت هلق بأي مجلد"]) + _ar_where(rng) if ar else \
            rng.choice(["print the current directory", "which directory are you in", "show the working directory"]) + _en_where(rng)
        return t, ["pwd"], ("المجلد الحالي: {r0}" if ar else "Current directory: {r0}")
    if k == 2:
        t = rng.choice(["اطبع اسم المستخدم", "من المستخدم الحالي", "ما اسم المستخدم الذي تعمل به"]) + _ar_where(rng) if ar else \
            rng.choice(["print the user name", "which user are you running as", "who is the current user"]) + _en_where(rng)
        return t, ["whoami"], ("المستخدم: {r0}" if ar else "User: {r0}")
    if k == 3:
        t = rng.choice(["اطبع تاريخ اليوم", "ما التاريخ اليوم", "شو التاريخ اليوم"]) + _ar_where(rng) if ar else \
            rng.choice(["print today's date", "what is the date today", "show the date"]) + _en_where(rng)
        return t, ["date +%F"], ("التاريخ: {r0}" if ar else "Date: {r0}")
    if k == 4:
        tok = _tok(rng)
        t = (rng.choice([f"شغّل الأمر echo {tok}", f"نفّذ الأمر echo {tok}", f"جرّب echo {tok}", f"اكتب في الطرفية echo {tok}"]) + _ar_where(rng)) if ar else \
            (rng.choice([f"run the command echo {tok}", f"execute echo {tok}", f"type echo {tok}"]) + _en_where(rng))
        return t, [f"echo {tok}"], ("الخرج: {r0}" if ar else "Output: {r0}")
    if k == 5:
        tok, f = _tok(rng), rng.choice(_FILES)
        t = (rng.choice([f"أنشئ ملفاً اسمه {f} فيه {tok} ثم اعرضه", f"اعمل ملف {f} واكتب فيه {tok} وورجيني محتواه", f"احفظ {tok} في ملف {f} ثم اقرأه"])) if ar else \
            rng.choice([f"create a file named {f} containing {tok} and show it", f"save {tok} into {f} then read it back"])
        return t, [f"echo {tok} > {f}", f"cat {f}"], ((f"محتوى {f}: " + "{r1}") if ar else (f"{f} contains " + "{r1}"))
    if k == 6:
        f = rng.choice(_FIX)
        t = rng.choice([f"كم سطراً في الملف {f}", f"عدّ أسطر {f}", f"قديش سطر في {f}"]) + _ar_where(rng) if ar else \
            rng.choice([f"how many lines are in {f}", f"count the lines of {f}"]) + _en_where(rng)
        return t, [f"wc -l < {f}"], ("عدد الأسطر: {r0}" if ar else "Lines: {r0}")
    if k == 7:
        a, b = rng.randrange(2, 99), rng.randrange(2, 99)
        op, w_ar, w_en = rng.choice([("*", "ضرب", "times"), ("+", "زائد", "plus"), ("-", "ناقص", "minus")])
        t = (rng.choice([f"احسب {a} {w_ar} {b} ببايثون", f"كم يساوي {a} {w_ar} {b}؟ احسبه", f"شغّل بايثون واحسب {a} {w_ar} {b}"]) + _ar_where(rng)) if ar else \
            (rng.choice([f"compute {a} {w_en} {b} with python", f"what is {a} {w_en} {b}? calculate it"]) + _en_where(rng))
        return t, [f'python3 -c "print({a}{op}{b})"'], ("الناتج: {r0}" if ar else "Result: {r0}")
    if k == 8:
        t = rng.choice(["كم نواة معالج عندك", "كم عدد أنوية المعالج", "قديش في نوى بالمعالج"]) + _ar_where(rng) if ar else \
            rng.choice(["how many CPU cores do you have", "count the processor cores"]) + _en_where(rng)
        return t, ["nproc"], ("عدد الأنوية: {r0}" if ar else "CPU cores: {r0}")
    if k == 9:
        t = rng.choice(["ما نظام التشغيل", "أي نظام تشغيل تستخدم", "شو نظام التشغيل"]) + _ar_where(rng) if ar else \
            rng.choice(["which operating system is this", "what OS are you running"]) + _en_where(rng)
        return t, ["uname -s"], ("نظام التشغيل: {r0}" if ar else "OS: {r0}")
    if k == 10:
        t = rng.choice(["كم مساحة القرص المتاحة", "اعرض المساحة الحرة على القرص", "قديش في مساحة فاضية"]) + _ar_where(rng) if ar else \
            rng.choice(["how much disk space is free", "show the free disk space"]) + _en_where(rng)
        return t, ["df -h . | awk 'NR==2{print $4}'"], ("المساحة الحرة: {r0}" if ar else "Free disk: {r0}")
    f = rng.choice(_FIX)
    t = rng.choice([f"اعرض أول 3 أسطر من {f}", f"ورجيني بداية الملف {f}"]) if ar else rng.choice([f"show the first 3 lines of {f}", f"print the start of {f}"])
    return t, [f"head -n 3 {f} | tr '\\n' ' '"], ((f"بداية {f}: " + "{r0}") if ar else (f"Start of {f}: " + "{r0}"))


def run_plan(task: str, plan, reply_t: str, term_factory):
    """Execute the plan on the terminal. -> (steps, reply) or None when any command failed (not a verified success: dropped).
    steps = [(history_before, target_text)] for every command and the final reply (the loop head's training views)."""
    term = term_factory()
    try:
        hist, res, steps = [], [], []
        for c in plan:
            cmd = c.replace("{r0}", res[0]) if "{r0}" in c and res else c
            steps.append((list(hist), "$ " + cmd))
            r = term.run(cmd, confirm=True)
            if not r.ok:
                return None
            out = (r.out or "").strip().replace("\n", " ")
            res.append(out)
            hist.append((cmd, out))
        reply = reply_t.format(**{f"r{i}": v for i, v in enumerate(res)})
        steps.append((list(hist), reply))
        return steps, reply
    finally:
        term.close()


def live_steps(rows) -> list[tuple[str, list]]:
    """Live log rows -> [(task, steps)] in the same view format as run_plan (the commands already ran and succeeded on the model's computer)."""
    out = []
    for task, hist, reply in rows:
        steps, h = [], []
        for cmd, res in hist:
            steps.append((list(h), "$ " + cmd))
            h.append((cmd, str(res).strip().replace("\n", " ")))
        if reply:
            steps.append((list(h), reply))
        out.append((task, steps))
    return out


# ---------------------------------------------------------------- 3. acceptance on real prompts (never trained on)

ACCEPT = [
    # the exact live-probe prompts of 2026-11-24/25
    {"q": "شغّل الأمر echo SHAM_OK على حاسوبك", "expect": "SHAM_OK"},
    {"q": "اعرض الملفات في المجلد الحالي على حاسوبك.", "first": "ls"},
    # other wordings / arguments
    {"q": "احسب 17 ضرب 23 على حاسوبك وأعطني الناتج", "expect": "391"},
    {"q": "اطبع اسم المستخدم الحالي على حاسوبك", "first": "whoami"},
    {"q": "what's the working directory on your computer?", "first": "pwd"},
    {"q": "أنشئ ملفاً باسم todo.md فيه KX4-7710 ثم اعرض محتواه", "expect": "KX4-7710", "file": ("todo.md", "KX4-7710")},
    {"q": "how many lines does names.txt have?", "expect": "6"},
    {"q": "ما تاريخ اليوم حسب حاسوبك؟", "first": "date"},
    {"q": "run echo GO_123 in the terminal", "expect": "GO_123"},
    {"q": "كم نواة في معالج حاسوبك؟", "first": "nproc"},
]


def accept_ok(case: dict, cmds: list, outs: list, oks: list, reply: str, read_file=None) -> bool:
    """A real prompt passes when: at least one command ran, every command succeeded, nothing still holds an unfilled slot, and the expected
    output / first command / file content is really there (read from the terminal, not trusted from the reply)."""
    if not cmds or not all(oks) or any(UNFILLED.search(c) for c in cmds) or UNFILLED.search(reply or ""):
        return False
    if "first" in case and cmds[0].split()[0] != case["first"]:
        return False
    if "expect" in case and case["expect"] not in " ".join(outs) + " " + (reply or ""):
        return False
    if "file" in case:
        name, text = case["file"]
        got = read_file(name) if read_file else None
        if got is None or text not in got:
            return False
    return True


def _check_disjoint():
    rng = random.Random(0)
    train = {episode(rng)[0] for _ in range(4000)}
    clash = [c["q"] for c in ACCEPT if c["q"] in train]
    assert not clash, f"acceptance prompts must never be training rows: {clash}"


_check_disjoint()
