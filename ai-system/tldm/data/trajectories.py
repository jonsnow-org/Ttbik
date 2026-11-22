"""Multi-step terminal episodes (the agent loop of the project book): the model sees the task and everything the terminal returned so far, and writes the NEXT block:
   "$ <command>"  = a command for the terminal   |   anything else = the final reply to the user (the terminal stays hidden behind the chat).
Every result is produced by really running the commands in the sandbox; no result is typed by hand. A step that needs a number copies it from the previous result (the feedback matters)."""
from __future__ import annotations

import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import terminal_tasks as T  # noqa: E402
import augment as AUG  # noqa: E402

OUT_FILES = [n + ".txt" for n in ("out", "report", "total", "result", "count", "data", "stats", "final")]
NEW_FILES = [n + ".txt" for n in ("summary", "answer", "number", "tally", "size")]     # never seen in training: tests copying the name from the task
CHAT = [("hello", "Hello! How can I help you?"), ("hi", "Hello! How can I help you?"), ("thanks", "You're welcome."), ("who are you", "I am Sham Pro. I work through a terminal."),
        ("مرحبا", "أهلا بك! كيف أساعدك؟"), ("شكرا", "على الرحب والسعة."), ("من انت", "أنا شام برو، أعمل عبر طرفية.")]


def view_text(task: str, hist) -> str:
    """The model's input as TEXT: the task, then every command and the result the terminal returned."""
    return task[:64] + "\n" + "".join(f"$ {c}\n> {r}\n" for c, r in hist)


def view_ids(tok, task: str, hist, in_len: int) -> list[int]:
    """The model's input as ids: the task, a newline, then the TAIL of everything the terminal returned (the end of the history is what matters), padded to in_len."""
    t = [i for i in tok.encode(task[:64], len(task.encode("utf-8")) + 1) if i][:32]
    h_text = "".join(f"$ {c}\n> {r}\n" for c, r in hist)
    h = [i for i in tok.encode(h_text, len(h_text.encode("utf-8")) + 1) if i]
    room = in_len - len(t) - 1
    s = t + [10] + (h[-room:] if room > 0 else [])
    return s + [0] * (in_len - len(s))


def delex_view(task: str, hist, delex: bool):
    """Argument slots for the loop (data/augment.py): file names/numbers of the task become @F1/@N1 in the task, the history and the target; relex() after writing."""
    if not delex:
        return task, hist, {}
    t, _, slots = AUG.delex(task)
    return t, [(AUG.apply_slots(c, slots), AUG.apply_slots(r, slots)) for c, r in hist], slots


def step_view(tok, task: str, hist, cfg) -> tuple:
    """-> (input ids, slots) exactly as in training (argument slots when cfg["delex"]); relex the written block with AUG.relex(text, slots)."""
    t, h, slots = delex_view(task, hist, cfg.get("delex", False))
    return view_ids(tok, t, h, cfg["in_len"]), slots


def make_episode(rng: random.Random, new_names: bool = False):
    """-> (task, plan, reply_template): plan = commands where {r0},{r1}.. are the stripped results of the earlier steps."""
    f = rng.choice(NEW_FILES if new_names else OUT_FILES)
    k = rng.randrange(6)
    if k == 0:
        t = rng.choice([f"count the errors in the log and save the number to {f}", f"how many errors are in app.log? write the count in {f}"])
        return t, ["grep ERROR app.log | wc -l", "echo {r0} > " + f], "Saved {r0} to " + f + "."
    if k == 1:
        t = rng.choice([f"count the files here and write the number in {f}", f"how many files are in this folder? save it to {f}"])
        return t, ["ls | wc -l", "echo {r0} > " + f], "Saved {r0} to " + f + "."
    if k == 2:
        t = rng.choice(["how many different names are in names.txt", "count the unique names"])
        return t, ["sort names.txt | uniq | wc -l"], "There are {r0} unique names."
    if k == 3:
        t = rng.choice(["Organize files and show me the result", "tidy up the files then list them"])
        return t, ["python3 organize.py", "ls"], "Done. Now: {r1}"
    if k == 4:
        t = rng.choice(["how many lines does the log have", "count the lines of app.log"])
        return t, ["wc -l app.log"], "Result: {r0}."
    c, r = rng.choice(CHAT)
    return c, [], r



# ---- open-argument episodes (2026-11-22) ------------------------------------------------------------------------------------------------------
# The first loop data wrote commands from a closed set. A live task such as "run echo <any token> on your computer", "create a file with <any text> and read it",
# "write a python program for <numbers> and run it" or "read <file> of <owner/repo> on GitHub" needs the head to COPY its arguments from the task (slots @T/@F/@N/@R,
# data/augment.py) and, for GitHub, to ask for the read-only tool instead of answering from memory. Commands are really run in the sandbox; the GitHub tool has no
# sandbox: its episodes END at the tool call (what the head must learn is to ASK for the read-only tool with the right repo/path); the app then gives the FULL result
# to the body, which writes the answer (the 4.5M head cannot summarise a file). No tool result is typed by hand anywhere.
# Nothing below equals or comes close to a live-suite task (LIVE_TASKS, checked by scripts/test_all.py): the head is measured on those words only by the live suite.
LIVE_TASKS = [
    "شغّل الأمر echo ZX7Q-4821 على حاسوبك واذكر ناتجه حرفياً.",
    "أنشئ على حاسوبك ملفاً باسم note.txt فيه النص QW9-5503 ثم اقرأه وأخبرني بمحتواه.",
    "اكتب برنامج بايثون يطبع مربعات الأعداد من 1 إلى 5 ونفّذه على حاسوبك وأخبرني بالناتج.",
    "اقرأ الملف package.json من المستودع jonsnow-org/Ttbik على GitHub واذكر قيمة الحقل name فيه.",
    "اعرض أسماء الملفات الموجودة في جذر المستودع jonsnow-org/Ttbik على GitHub.",
    "اقرأ المستودع jonsnow-org/Ttbik على GitHub واشرح بنيته في فقرة قصيرة",
]
_UP, _AL = "ABCDEFGHJKLMNPQRSTUVWXYZ", "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789"
OPEN_FILES = [n + ext for n in ("memo", "log1", "notes", "todo", "draft", "scratch", "result", "temp") for ext in (".txt", ".md")]
OPEN_REPOS = ["acme/webapp", "octo-labs/engine", "demo-org/store", "team-x/api-server", "northwind/docs-site", "zeta-co/mobile-app", "kappa/data-tools", "lumen-works/ui-kit"]
OPEN_TOOLS_PATHS = ["package.json", "composer.json", "manifest.json", "config.json", "app.json"]
NAME_WORDS = ["alpha", "bravo", "cedar", "delta", "ember", "fjord", "garnet", "harbor", "indigo", "jasper", "kestrel", "lotus", "meadow", "nimbus", "onyx", "prism"]
LIST_ITEMS = ["README.md", "package.json", "src", "docs", "tests", "LICENSE", "Makefile", "app", "public", "scripts"]


def tool_call_text(name: str, args: dict) -> str:
    """The exact text the serve layer parses and records: `@tool <name> <JSON>` (sorted keys, default separators)."""
    import json
    return "@tool " + name + " " + json.dumps(args, ensure_ascii=False, sort_keys=True)


def _token(rng: random.Random) -> str:
    while True:
        a = "".join(rng.choice(_AL) for _ in range(rng.choice((2, 3, 4))))
        b = "".join(rng.choice(_AL) for _ in range(rng.choice((3, 4, 5))))
        t = a + "-" + b
        if any(c.isdigit() for c in t) and any(c.isalpha() for c in t) and len(a) >= 2 and len(b) >= 2:
            return t


_AR_ASK = ["اذكر ناتجه", "أخبرني بالنتيجة", "ما الذي ظهر", "وأرني الخرج"]
_EN_ASK = ["tell me what it printed", "and report the output", "then tell me the result", "and show me what came out"]


def make_open_episode(rng: random.Random):
    """-> (task, plan, reply_t). plan items: ("cmd", command) run in the sandbox, or ("tool", call_text, None) ends the episode at the tool call. {r0},{r1}.. in reply_t are step results."""
    ar = rng.random() < 0.5
    ask = rng.choice(_AR_ASK if ar else _EN_ASK)
    k = rng.randrange(7)
    if k == 0:                                   # echo any token
        tok = _token(rng)
        verb = rng.choice(["نفّذ", "جرّب", "أطلق"] if ar else ["execute", "try", "launch", "do"])
        t = (f"{verb} الأمر echo {tok} في الطرفية، {ask}." if ar else f"{verb} the command echo {tok} in the terminal, {ask}.")
        return t, [("cmd", f"echo {tok}")], ("الخرج: {r0}" if ar else "It printed {r0}.")
    if k == 1:                                   # file with any text, then read it back
        tok, f = _token(rng), rng.choice(OPEN_FILES)
        t = (f"اصنع ملفاً اسمه {f} وضع فيه {tok} ثم افتحه وأعلمني بما فيه." if ar else f"make a file called {f} holding {tok}, then open it and let me know what it holds.")
        return t, [("cmd", f"echo {tok} > {f}"), ("cmd", f"cat {f}")], (f"محتوى {f}: " + "{r1}" if ar else f"{f} contains " + "{r1}.")
    if k == 2:                                   # python one-liner over a numeric range
        a, b = rng.randrange(1, 6), rng.randrange(6, 12)
        op, word_en, word_ar = rng.choice([("i*i", "squares", "المربعات"), ("i*2", "doubles", "الأضعاف"), ("i+10", "each number plus ten", "كل عدد زائد عشرة")])
        t = (f"أنشئ سكربت بايثون يحسب {word_ar} من {a} حتى {b} وشغّله، {ask}." if ar else f"build a python script that computes the {word_en} for {a} through {b}, run it, {ask}.")
        return t, [("cmd", f'python3 -c "for i in range({a},{b}+1): print({op})"')], ("الخرج: {r0}" if ar else "Output: {r0}")
    if k == 3:                                   # read a field of a file in a GitHub repository (read-only tool)
        repo, path, val = rng.choice(OPEN_REPOS), rng.choice(OPEN_TOOLS_PATHS), rng.choice(NAME_WORDS) + "-" + rng.choice(NAME_WORDS)
        t = (f"من مستودع {repo} على GitHub افتح الملف {path} وأعطني قيمة الحقل name." if ar else f"open {path} in the GitHub repo {repo} and give me its name field.")
        return t, [("tool", tool_call_text("github_read_file", {"repo": repo, "path": path}), None)], None
    if k == 4:                                   # list the root of a GitHub repository (read-only tool)
        repo = rng.choice(OPEN_REPOS)
        t = (f"ما الملفات في جذر مستودع {repo} على GitHub؟" if ar else f"what files sit at the top level of the GitHub repo {repo}?")
        return t, [("tool", tool_call_text("github_list_files", {"repo": repo, "path": ""}), None)], None
    if k == 5:                                   # run, then a second command that depends on the first result (the feedback matters)
        a, f = rng.randrange(2, 9), rng.choice(OPEN_FILES)
        t = (f"احسب مجموع الأعداد من 1 إلى {a * 10} بالطرفية ثم اكتب الناتج في {f}." if ar else f"add up 1 to {a * 10} in the terminal and save the total to {f}.")
        return t, [("cmd", f'python3 -c "print(sum(range(1,{a * 10}+1)))"'), ("cmd", "echo {r0} > " + f)], (f"حفظت {{r0}} في {f}." if ar else "Saved {r0} to " + f + ".")
    tok = _token(rng)                            # k == 6: a token that must NOT be run: plain chat about it needs no command
    return (f"ما رأيك بالرمز {tok}؟" if ar else f"what do you think of the code {tok}?"), [], ("لا شيء هنا لأنفّذه. أشغّله؟" if ar else "Nothing to run there. Run it?")


def run_open_episode(task: str, plan, reply_t: str, term_factory=None):
    """Like run_episode for make_open_episode plans. -> (steps, reply, snapshot); steps = [(history_before, target_text)] incl. the final reply."""
    term = (term_factory or T.fresh)()
    try:
        hist, res, steps = [], [], []
        for item in plan:
            if item[0] == "tool":                      # the episode ends here: the tool is not run, the app answers from its full result
                steps.append((list(hist), "$ " + item[1]))
                break
            cmd = item[1].replace("{r0}", res[0]) if "{r0}" in item[1] and res else item[1]
            steps.append((list(hist), "$ " + cmd))
            r = term.run(cmd, confirm=True)
            out = (r.out if r.ok else (r.refused or r.out)).strip().replace("\n", " ")
            res.append(out)
            hist.append((cmd, out))
        if reply_t is None:
            return steps, "", T.snapshot(term)
        reply = reply_t.format(**{f"r{i}": v for i, v in enumerate(res)}) if "{r" in reply_t else reply_t
        steps.append((list(hist), reply))
        return steps, reply, T.snapshot(term)
    finally:
        term.close()


def run_episode(task: str, plan, reply_t: str, term_factory=None):
    """Runs the plan in a fresh sandbox. -> (steps, reply, final_snapshot) with steps = [(history_before_the_step, target_text)] for every step incl. the final reply."""
    term = (term_factory or T.fresh)()          # term_factory: e.g. the model's own embedded computer (train_sham2.computer_terminal)
    try:
        hist, res, steps = [], [], []
        for cmd_t in plan:
            cmd = cmd_t.format(**{f"r{i}": v for i, v in enumerate(res)})
            steps.append((list(hist), "$ " + cmd))
            r = term.run(cmd, confirm=True)
            out = (r.out if r.ok else (r.refused or r.out)).strip().replace("\n", " ")
            res.append(out)
            hist.append((cmd, out))
        reply = reply_t.format(**{f"r{i}": v for i, v in enumerate(res)})
        steps.append((list(hist), reply))
        return steps, reply, T.snapshot(term)
    finally:
        term.close()


def corpus_texts(n: int, seed: int, delex: bool = False) -> list[str]:
    """Texts the tokenizer is trained on: tasks, commands and replies of TRAINING episodes (file names of the training split only)."""
    rng = random.Random(seed)
    out = []
    for _ in range(n):
        task, plan, reply_t = make_episode(rng)
        steps, _, _ = run_episode(task, plan, reply_t)
        dtask, _, slots = delex_view(task, [], delex)
        out.append(dtask)
        for h, t in steps:
            _, h, _ = delex_view(task, h, delex)
            out.append(AUG.apply_slots(t, slots) if delex else t)
            out += [f"$ {c}\n> {r}\n" for c, r in h]
    return out


def make_dataset(n: int, seed: int, tok, in_len: int, block: int, delex: bool = False):
    rng = random.Random(seed)
    xs, ys = [], []
    for _ in range(n):
        task, plan, reply_t = make_episode(rng)
        steps, _, _ = run_episode(task, plan, reply_t)
        for h, tgt in steps:
            dtask, dh, slots = delex_view(task, h, delex)
            xs.append(view_ids(tok, dtask, dh, in_len)); ys.append(tok.encode(AUG.apply_slots(tgt, slots) if delex else tgt, block))
    return xs, ys


if __name__ == "__main__":
    rng = random.Random(1)
    for _ in range(6):
        task, plan, reply_t = make_episode(rng)
        steps, reply, snap = run_episode(task, plan, reply_t)
        print(task, "->", [t for _, t in steps])
