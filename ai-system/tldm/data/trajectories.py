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
CHAT = [("hello", "Hello! How can I help you?"), ("hi", "Hello! How can I help you?"), ("thanks", "You're welcome."), ("who are you", "I am Sham. I work through a terminal."),
        ("مرحبا", "أهلا بك! كيف أساعدك؟"), ("شكرا", "على الرحب والسعة."), ("من انت", "أنا شام، أعمل عبر طرفية.")]


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


def run_episode(task: str, plan, reply_t: str):
    """Runs the plan in a fresh sandbox. -> (steps, reply, final_snapshot) with steps = [(history_before_the_step, target_text)] for every step incl. the final reply."""
    term = T.fresh()
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
