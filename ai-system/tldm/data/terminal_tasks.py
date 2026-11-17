"""Terminal tasks {task, command, result, success}: the 30 training examples of the decisive experiment and 12 held-out paraphrases. Results are NOT written by hand: every command is run in the sandbox."""
from __future__ import annotations

import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "terminal"))
from sandbox_terminal import SandboxTerminal  # noqa: E402

ORGANIZE = open(os.path.join(HERE, "..", "tools", "organize.py"), encoding="utf-8").read()
TRUSTED = {"organize.py": hashlib.sha256(ORGANIZE.encode("utf-8")).hexdigest()}
FIXTURE = {
    "README.md": "SHAM T-LDM demo folder\nthis folder is a small test bed\nit has a log and a names list\nand mixed files\nto organize\n",
    "app.log": "INFO start\nINFO load config\nERROR disk almost full\nINFO retry\nERROR timeout\nINFO done\n",
    "names.txt": "omar\nali\nsara\nali\nnoor\nomar\n",
    "a.txt": "alpha\n", "b.jpg": "bbb\n", "c.txt": "gamma\n", "d.jpg": "ddd\n", "e.png": "eee\n",
    "organize.py": ORGANIZE,
}

TRAIN = [
    ("list files", "ls"), ("show the current folder", "pwd"), ("how many files are here", "ls | wc -l"), ("show the readme", "cat README.md"),
    ("first 3 lines of the log", "head -n 3 app.log"), ("last 2 lines of the log", "tail -n 2 app.log"), ("count the lines in the log", "wc -l app.log"),
    ("find the errors in the log", "grep ERROR app.log"), ("sort the names", "sort names.txt"), ("unique names", "sort names.txt | uniq"),
    ("create a backup folder", "mkdir backup"), ("create an empty file notes.txt", "touch notes.txt"), ("write hello to hello.txt", "echo hello > hello.txt"),
    ("what is the date", "date"), ("count from 1 to 5", "seq 1 5"), ("Organize files", "python3 organize.py"), ("count the words in the readme", "wc -w README.md"),
    ("add up 1 to 100", 'python3 -c "print(sum(range(1,101)))"'), ("show lines with INFO", "grep INFO app.log"), ("how many errors are in the log", "grep ERROR app.log | wc -l"),
    ("اعرض الملفات", "ls"), ("اعرض المجلد الحالي", "pwd"), ("اعرض ملف readme", "cat README.md"), ("رتب الاسماء", "sort names.txt"), ("نظم الملفات", "python3 organize.py"),
    ("كم سطرا في السجل", "wc -l app.log"), ("ابحث عن الاخطاء في السجل", "grep ERROR app.log"), ("أنشئ ملف todo.txt", "touch todo.txt"), ("ما هو التاريخ", "date"),
    ("اكتب مرحبا في greet.txt", "echo marhaba > greet.txt"),
]
HELDOUT = [
    ("show me all the files", "ls"), ("which folder am I in", "pwd"), ("print the readme file", "cat README.md"), ("tidy up the files", "python3 organize.py"),
    ("number of lines in the log", "wc -l app.log"), ("sort the names file", "sort names.txt"), ("make an empty file called todo.txt", "touch todo.txt"),
    ("show errors from the log", "grep ERROR app.log"), ("today's date", "date"), ("list the files here", "ls"), ("نظّم الملفات", "python3 organize.py"), ("اعرض كل الملفات", "ls"),
]


def fresh() -> SandboxTerminal:
    t = SandboxTerminal(trusted=TRUSTED)
    for name, text in FIXTURE.items():
        with open(os.path.join(t.dir, name), "w", encoding="utf-8") as f:
            f.write(text)
    return t


def snapshot(t: SandboxTerminal) -> str:
    rows = []
    for root, dirs, files in os.walk(t.dir):
        dirs.sort()
        for f in sorted(files):
            p = os.path.join(root, f)
            rows.append(os.path.relpath(p, t.dir) + ":" + hashlib.md5(open(p, "rb").read()).hexdigest())
        for d in dirs:
            rows.append(os.path.relpath(os.path.join(root, d), t.dir) + "/")
    return "\n".join(sorted(rows))


def execute(command: str, confirm: bool = True):
    """-> (ok, output, snapshot_of_the_folder_after). `confirm=True` stands for the human saying yes to a confirmation request."""
    t = fresh()
    try:
        r = t.run(command, confirm=False)
        if r.needs_confirmation and confirm:
            r = t.run(command, confirm=True)
        return r.ok, (r.out if r.ok else r.refused or r.out), snapshot(t)
    finally:
        t.close()


def same_effect(reference: str, produced: str) -> bool:
    a, b = execute(reference), execute(produced)
    return a == b and a[0]


def build_jsonl(path: str) -> int:
    n = 0
    with open(path, "w", encoding="utf-8") as f:
        for task, cmd in TRAIN:
            ok, out, _ = execute(cmd)
            f.write(json.dumps({"task": task, "command": cmd, "result": out[:300], "success": ok}, ensure_ascii=False) + "\n")
            n += 1
    return n


if __name__ == "__main__":
    print(build_jsonl(os.path.join(HERE, "terminal_30.jsonl")), "examples written")
