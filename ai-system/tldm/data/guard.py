"""GUARD: a frozen set of natural requests for the TRAINING commands, used ONLY by the self-evolution gate (2026-11-18).

Why: the gate's dev set comes from the same grammar as the replay rewordings, so a web adapter that a router sends to naturally-worded requests could pass
the gate and still break the held-out sets (measured: seed 0 held-out 0.917 -> 0.75 with family-wide known-wording adapters). GUARD is hand-written in the
held-out STYLE (free wording, EN + AR) but is a different set:
  * disjoint from HELDOUT and HELDOUT2 (no text equal or too close to a held-out task: word-set Jaccard >= 0.5 is dropped, checked by `check()`);
  * never trained on: evolution decontaminates training text against it like against held-out;
  * it IS used for selection (the gate), so it is not an evaluation set. Held-out 1+2 stay evaluation-only.
"""
from __future__ import annotations

import rewordings as RW
import terminal_tasks as T

_RAW = [
    ("what's inside this directory", "ls"), ("enumerate the stuff in here", "ls"), ("can I see what this folder holds", "ls"), ("dir listing please", "ls"),
    ("which path is this", "pwd"), ("tell me the full path of my folder", "pwd"), ("where does this shell sit", "pwd"),
    ("tally the files in this place", "ls | wc -l"), ("how many things are in this folder", "ls | wc -l"),
    ("dump README.md to the screen", "cat README.md"), ("let me read what README.md contains", "cat README.md"), ("readme text pls", "cat README.md"),
    ("opening trio of lines in the logfile", "head -n 3 app.log"), ("peek at the beginning of the log, 3 lines", "head -n 3 app.log"),
    ("the closing 2 lines of app.log", "tail -n 2 app.log"), ("peek at the end of the log, 2 lines", "tail -n 2 app.log"),
    ("line total for app.log", "wc -l app.log"), ("how long is app.log in lines", "wc -l app.log"),
    ("pull out every ERROR entry", "grep ERROR app.log"), ("which log lines are errors", "grep ERROR app.log"), ("filter app.log down to ERROR", "grep ERROR app.log"),
    ("names.txt from a to z", "sort names.txt"), ("arrange names.txt alphabetically", "sort names.txt"),
    ("each name just one time, sorted", "sort names.txt | uniq"), ("drop repeated names from the list", "sort names.txt | uniq"),
    ("new directory called backup", "mkdir backup"), ("set up a backup dir", "mkdir backup"),
    ("blank file named notes.txt", "touch notes.txt"), ("start an empty notes.txt", "touch notes.txt"),
    ("store hello inside hello.txt", "echo hello > hello.txt"), ("hello.txt should contain hello", "echo hello > hello.txt"),
    ("current date and time please", "date"), ("what's the time", "date"),
    ("numbers one through five", "seq 1 5"), ("print 1 2 3 4 5", "seq 1 5"),
    ("group my stuff by type", "python3 organize.py"), ("run the organizer script", "python3 organize.py"),
    ("word total of README.md", "wc -w README.md"), ("how many words does the readme have", "wc -w README.md"),
    ("the INFO entries please", "grep INFO app.log"), ("only info messages from app.log", "grep INFO app.log"),
    ("number of ERROR lines", "grep ERROR app.log | wc -l"), ("tally the errors in app.log", "grep ERROR app.log | wc -l"),
    ("ما الموجود في هذا المجلد", "ls"), ("وين أنا في المسارات", "pwd"), ("اقرأ لي README.md", "cat README.md"), ("أول ثلاث أسطر في app.log", "head -n 3 app.log"),
    ("سطران من نهاية app.log", "tail -n 2 app.log"), ("كم طول السجل بالأسطر", "wc -l app.log"), ("استخرج سطور ERROR", "grep ERROR app.log"),
    ("رتب names.txt أبجديا", "sort names.txt"), ("كل اسم مرة واحدة", "sort names.txt | uniq"), ("اعمل مجلد backup", "mkdir backup"),
    ("كم الساعة الآن", "date"), ("شغّل سكربت التنظيم", "python3 organize.py"), ("كم مرة ظهر ERROR", "grep ERROR app.log | wc -l"),
]


def check(rows=None) -> list:
    """Problems ([] = none): too close to a held-out task, or not a training command."""
    rows = _RAW if rows is None else rows
    cmds = {c for _, c in T.TRAIN}
    return [f"{t!r} too close to held-out {RW.too_close(t)!r}" for t, _ in rows if RW.too_close(t)] + [f"{c!r} not a training command" for _, c in rows if c not in cmds]


GUARD = [(t, c) for t, c in _RAW if not RW.too_close(t) and c in {c2 for _, c2 in T.TRAIN}]


def too_close(task: str) -> str:
    """'' or the guard task `task` is too close to (training decontamination)."""
    return RW.too_close(task, GUARD)
