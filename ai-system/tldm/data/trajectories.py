"""Multi-step terminal episodes (the agent loop of the project book): the model sees the task and everything the terminal returned so far, and writes the NEXT block:
   "$ <command>"  = a command for the terminal   |   anything else = the final reply to the user (the terminal stays hidden behind the chat).
Every result is produced by really running the commands in the sandbox; no result is typed by hand. A step that needs a number copies it from the previous result (the feedback matters)."""
from __future__ import annotations

import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import terminal_tasks as T  # noqa: E402

IN_LEN, BLOCK = 192, 64
OUT_FILES = ["out.txt", "report.txt", "total.txt", "result.txt", "count.txt"]
CHAT = [("hello", "Hello! How can I help you?"), ("hi", "Hello! How can I help you?"), ("thanks", "You're welcome."), ("who are you", "I am Sham. I work through a terminal."),
        ("مرحبا", "أهلا بك! كيف أساعدك؟"), ("شكرا", "على الرحب والسعة."), ("من انت", "أنا شام، أعمل عبر طرفية.")]


def view(task: str, hist) -> list[int]:
    h = "".join(f"$ {c}\n> {r}\n" for c, r in hist)
    tb = list(task.encode("utf-8"))[:64]
    hb = list(h.encode("utf-8"))[-(IN_LEN - len(tb) - 1):]
    s = tb + [10] + hb
    return s + [0] * (IN_LEN - len(s))


def pad(text: str) -> list[int]:
    b = list(text.encode("utf-8"))[:BLOCK]
    return b + [0] * (BLOCK - len(b))


def make_episode(rng: random.Random):
    """-> (task, plan, reply_template): plan = commands where {r0},{r1}.. are the stripped results of the earlier steps."""
    f = rng.choice(OUT_FILES)
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


def run_episode(task: str, plan, reply_t: str):
    """Runs the plan in a fresh sandbox. -> (steps, reply, final_snapshot) with steps = [(input_view_before_the_step, target_text)] for every step incl. the final reply."""
    term = T.fresh()
    try:
        hist, res, steps = [], [], []
        for cmd_t in plan:
            cmd = cmd_t.format(**{f"r{i}": v for i, v in enumerate(res)})
            steps.append((view(task, hist), "$ " + cmd))
            r = term.run(cmd, confirm=True)
            out = (r.out if r.ok else (r.refused or r.out)).strip().replace("\n", " ")
            res.append(out)
            hist.append((cmd, out))
        reply = reply_t.format(**{f"r{i}": v for i, v in enumerate(res)})
        steps.append((view(task, hist), reply))
        return steps, reply, T.snapshot(term)
    finally:
        term.close()


def make_dataset(n: int, seed: int):
    rng = random.Random(seed)
    xs, ys = [], []
    for _ in range(n):
        task, plan, reply_t = make_episode(rng)
        steps, _, _ = run_episode(task, plan, reply_t)
        for v, tgt in steps:
            xs.append(v); ys.append(pad(tgt))
    return xs, ys


if __name__ == "__main__":
    rng = random.Random(1)
    for _ in range(6):
        task, plan, reply_t = make_episode(rng)
        steps, reply, snap = run_episode(task, plan, reply_t)
        print(task, "->", [t for _, t in steps])
