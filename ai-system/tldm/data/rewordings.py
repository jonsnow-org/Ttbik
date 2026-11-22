"""More ways to ask for the SAME training commands (held-out generalization, step 1 of the 2026-11-18 plan).

Rules, checked by `check()` (and by test_all.py):
  * only commands already in terminal_tasks.TRAIN; nothing from a held-out set is used as training text;
  * every generated task is dropped if it equals a held-out task or is too close to one (word-set Jaccard >= 0.5 against ANY held-out task);
  * HELDOUT2 is a second frozen held-out set written BEFORE any training with these rewordings (2026-11-18), so a gain on the old HELDOUT
    (whose 7 misses the author had seen) can be checked on text nobody tuned against. Both sets are only ever evaluated, never trained on.
The generator is compositional (verb x object x politeness), not a list of answers to known questions.
"""
from __future__ import annotations

import itertools
import random
import re

import terminal_tasks as T

HELDOUT2 = [
    ("what files do we have", "ls"), ("where am I right now", "pwd"), ("open the readme", "cat README.md"),
    ("give me the top 3 lines of app.log", "head -n 3 app.log"), ("the final two lines of the log please", "tail -n 2 app.log"),
    ("search the log for ERROR", "grep ERROR app.log"), ("put the names in alphabetical order", "sort names.txt"),
    ("names without duplicates", "sort names.txt | uniq"), ("make a folder named backup", "mkdir backup"), ("what day is it", "date"),
    ("arrange the files into folders", "python3 organize.py"), ("كم ملفا هنا", "ls | wc -l"), ("رتّب الملفات في مجلدات", "python3 organize.py"),
    ("اعرض آخر سطرين من السجل", "tail -n 2 app.log"),
]

_SHOW = ["show", "list", "display", "print", "give me", "output", "let me see", "get", "pull up", "bring up", "tell me", "i want to see"]
_AR_SHOW = ["اعرض", "أظهر", "أرني", "اطبع"]
GRAMMAR = {
    "ls": [(_SHOW, ["the files", "files", "the folder contents", "the directory listing", "what is in this folder", "the contents of the directory"]),
           (["ls", "what is"], ["here", "in this directory"]), (_AR_SHOW, ["الملفات", "محتوى المجلد", "ما في المجلد"])],
    "pwd": [(_SHOW, ["the current directory", "the working directory", "the path of this folder", "the current path", "my location"]),
            (["what is"], ["the current directory", "the working directory", "the current path"]), (_AR_SHOW, ["المسار الحالي", "مسار المجلد", "مكاني الحالي"])],
    "ls | wc -l": [(["count", "how many"], ["the files", "files are in this folder", "files in the directory", "items in the folder"]), (["عد", "كم عدد"], ["الملفات", "ملفات المجلد"])],
    "cat README.md": [(_SHOW, ["the readme", "README.md", "readme contents", "the text of the readme", "what the readme says"]), (["read"], ["the readme", "README.md"]),
                      (_AR_SHOW, ["محتوى readme", "ملف README.md"])],
    "head -n 3 app.log": [(_SHOW, ["the first 3 lines of the log", "the top 3 lines of app.log", "3 lines from the start of the log"]), (_AR_SHOW, ["أول 3 أسطر من السجل"])],
    "tail -n 2 app.log": [(_SHOW, ["the last 2 lines of the log", "the bottom 2 lines of app.log", "2 lines from the end of the log"]), (_AR_SHOW, ["آخر 2 أسطر من السجل"])],
    "wc -l app.log": [(["count", "how many"], ["the lines of the log", "lines are in app.log", "log lines"]), (_SHOW, ["the line count of the log", "how long the log is in lines"]),
                      (["عد", "كم عدد"], ["أسطر السجل", "سطور app.log"])],
    "grep ERROR app.log": [(_SHOW, ["the errors in the log", "ERROR lines", "error lines from app.log", "the log errors"]), (["find", "grep", "look for"], ["errors in the log", "ERROR in app.log", "the error lines"]),
                           (["ابحث عن", "اعرض"], ["أخطاء السجل", "الأخطاء في app.log"])],
    "sort names.txt": [(["sort", "order", "alphabetize"], ["the names", "names.txt", "the list of names"]), (_SHOW, ["the names sorted", "names.txt sorted"]), (["رتب", "رتّب"], ["الأسماء", "ملف names.txt"])],
    "sort names.txt | uniq": [(_SHOW, ["the unique names", "each name once", "distinct names", "the names with no repeats"]), (["dedupe", "remove duplicate"], ["names", "the names"]),
                              (_AR_SHOW, ["الأسماء دون تكرار", "الأسماء الفريدة"])],
    "mkdir backup": [(["create", "make", "add"], ["a backup folder", "a folder called backup", "the backup directory", "a directory named backup"]), (["أنشئ"], ["مجلد backup", "مجلدا للنسخ backup"])],
    "touch notes.txt": [(["create", "make"], ["an empty file notes.txt", "a blank notes.txt", "the file notes.txt", "notes.txt empty"])],
    "touch todo.txt": [(["أنشئ", "اصنع"], ["ملف todo.txt", "ملفا فارغا todo.txt"])],
    "echo hello > hello.txt": [(["write", "put", "save"], ["hello to hello.txt", "hello in hello.txt", "the word hello into hello.txt"])],
    "echo marhaba > greet.txt": [(["اكتب", "احفظ"], ["مرحبا في greet.txt", "كلمة مرحبا في greet.txt"])],
    "date": [(_SHOW, ["the date", "the current date", "the date and time", "the time now"]), (["what is"], ["the date now", "the current time"]), (["ما"], ["التاريخ اليوم", "الوقت الآن"]), (_AR_SHOW, ["التاريخ"])],
    "seq 1 5": [(["count", "print the numbers", "list numbers"], ["1 to 5", "from 1 through 5", "one to five"])],
    "python3 organize.py": [(["organize", "sort out", "clean up", "group"], ["the files", "files by type", "the folder", "files into type folders"]), (["run"], ["organize.py", "the organizer"]),
                            (["نظم", "رتب"], ["الملفات حسب النوع", "المجلد"])],
    "wc -w README.md": [(["count", "how many"], ["the words in the readme", "words are in README.md", "readme words"])],
    'python3 -c "print(sum(range(1,101)))"': [(["add up", "sum", "total"], ["1 to 100", "the numbers 1 to 100", "one through a hundred"])],
    "grep INFO app.log": [(_SHOW, ["INFO lines", "the info lines of the log", "INFO entries in app.log"]), (["find", "grep"], ["INFO in the log", "info lines in app.log"])],
    "grep ERROR app.log | wc -l": [(["count", "how many"], ["the errors in the log", "ERROR lines are in app.log", "errors are there"]), (["كم"], ["خطأ في السجل", "عدد الأخطاء"])],
}
_PRE = ["", "", "", "please ", "can you ", "now ", "could you ", "go ahead and ", "hey, ", "i need you to "]
_POST = ["", "", "", " please", " now", " for me", " quickly", " thanks"]


def _words(s: str) -> set:
    return set(re.findall(r"\w+", s.lower()))


def too_close(task: str, sets=None) -> str:
    """'' or the held-out task this one is too close to (equal, or word-set Jaccard >= 0.5)."""
    w = _words(task)
    for held, _ in (sets or (T.HELDOUT + HELDOUT2)):
        h = _words(held)
        if task.strip().lower() == held.strip().lower() or (w and len(w & h) / len(w | h) >= 0.5):
            return held
    return ""


def generate(seed: int = 0, per_command: int = 24) -> list:
    """-> [(task, command)] for TRAIN's commands, held-out-safe, deterministic for a seed."""
    rng = random.Random(seed)
    out, train_cmds = [], {c for _, c in T.TRAIN}
    for cmd, rules in GRAMMAR.items():
        assert cmd in train_cmds, cmd
        cands = sorted({f"{v} {o}" for verbs, objs in rules for v, o in itertools.product(verbs, objs)})
        rng.shuffle(cands)
        kept = [c for c in cands if not too_close(c)][:per_command]
        out += [(c if re.search(r"[\u0600-\u06FF]", c) else rng.choice(_PRE) + c + rng.choice(_POST), cmd) for c in kept]
    return [(t, c) for t, c in out if not too_close(t)]


def check(rows) -> list:
    """Problems that would make a measurement dishonest ([] = none)."""
    bad = [f"{t!r} too close to held-out {too_close(t)!r}" for t, _ in rows if too_close(t)]
    train_cmds = {c for _, c in T.TRAIN}
    bad += [f"{c!r} is not a training command" for _, c in rows if c not in train_cmds]
    held = {h.lower() for h, _ in T.HELDOUT + HELDOUT2}
    bad += [f"{t!r} is a held-out text" for t, _ in rows if t.lower().strip() in held]
    return bad


if __name__ == "__main__":
    rows = generate()
    print(len(rows), "rewordings;", len({c for _, c in rows}), "commands; problems:", check(rows))
    for t, c in rows[:12]:
        print(f"  {t!r} -> {c}")
