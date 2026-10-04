"""
Sham's cell sync ("مزامنة الخلايا") — notebook cell fixes reach already-imported
notebooks without re-importing them.

A Kaggle notebook keeps its own copy of every cell, so a fix inside a CELL used to need a
manual File → Import Notebook. The code (modules) is cloned from GitHub at every run, so this
module — installed from sham_inputs, early in every notebook — registers an IPython input
transformer that, right before a cell runs, compares the cell's text with the table
`sham_cell_updates.json` and, if it is an OLD version of a cell the repository has since fixed,
runs the repository's current version of that cell instead (and says so in the log).

  • only exact, previously published versions of a cell are replaced (matched by hash), so a
    cell the owner edited by hand is never touched;
  • the table is generated from the repository history by `python sham_cell_sync.py --build`
    (old version → current version of the same cell, aligned within each notebook);
  • cells that ran before sham_inputs was imported (the setup cells) cannot be synced;
  • SHAM_NO_CELL_SYNC=1 switches it off.

This is deployment plumbing only — it writes no answers and no rules for the model.
"""

from __future__ import annotations

import difflib
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
TABLE_PATH = HERE / "sham_cell_updates.json"
NOTEBOOKS = HERE / "kaggle_notebooks"
KEEP_VERSIONS = 25  # per notebook: the versions an owner may plausibly have imported
_STATE = {"table": None, "replaced": []}


def norm(text: str) -> str:
    return "\n".join(line.rstrip() for line in text.replace("\r", "").strip("\n").split("\n")).strip()


def digest(text: str) -> str:
    return hashlib.sha1(norm(text).encode("utf-8")).hexdigest()[:16]


def _code_cells(nb: dict) -> list[str]:
    return ["".join(c["source"]) if isinstance(c["source"], list) else c["source"]
            for c in nb["cells"] if c["cell_type"] == "code"]


def align(old: list[str], new: list[str]) -> dict[int, int]:
    """old cell index → new cell index for cells that are versions of each other."""
    ha, hb = [digest(x) for x in old], [digest(x) for x in new]
    out: dict[int, int] = {}
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, ha, hb, autojunk=False).get_opcodes():
        if tag == "equal":
            out.update({i1 + k: j1 + k for k in range(i2 - i1)})
        elif tag == "replace":
            used: set[int] = set()
            for i in range(i1, i2):
                best, score = None, 0.6
                for j in range(j1, j2):
                    if j in used:
                        continue
                    r = difflib.SequenceMatcher(None, norm(old[i]), norm(new[j]), autojunk=False).quick_ratio()
                    if r >= score and difflib.SequenceMatcher(None, norm(old[i]), norm(new[j]), autojunk=False).ratio() >= 0.6:
                        best, score = j, r
                if best is not None:
                    used.add(best)
                    out[i] = best
    return out


def build(repo: Path | None = None, keep: int = KEEP_VERSIONS) -> dict:
    """{"map": {old_hash: new_hash}, "text": {new_hash: source}} from git history."""
    repo = repo or HERE
    top = subprocess.check_output(["git", "-C", str(repo), "rev-parse", "--show-toplevel"], text=True).strip()
    rel_dir = os.path.relpath(NOTEBOOKS, top)
    table = {"map": {}, "text": {}}
    for nb_path in sorted(NOTEBOOKS.glob("*.ipynb")):
        rel = f"{rel_dir}/{nb_path.name}".replace("\\", "/")
        current = _code_cells(json.loads(nb_path.read_text(encoding="utf-8")))
        revs = subprocess.check_output(["git", "-C", top, "log", f"-{keep}", "--format=%H", "--", rel], text=True).split()
        for rev in revs:
            try:
                old = _code_cells(json.loads(subprocess.check_output(["git", "-C", top, "show", f"{rev}:{rel}"])))
            except Exception:
                continue
            for i, j in align(old, current).items():
                if digest(old[i]) != digest(current[j]):
                    table["map"][digest(old[i])] = digest(current[j])
                    table["text"][digest(current[j])] = current[j]
    # a replacement must never itself be replaced again (no chains/cycles)
    table["map"] = {k: v for k, v in table["map"].items() if v not in table["map"] and k != v}
    table["text"] = {h: t for h, t in table["text"].items() if h in set(table["map"].values())}
    return table


def load_table() -> dict:
    if _STATE["table"] is None:
        try:
            _STATE["table"] = json.loads(TABLE_PATH.read_text(encoding="utf-8"))
        except Exception:
            _STATE["table"] = {"map": {}, "text": {}}
    return _STATE["table"]


def sync_text(source: str) -> str | None:
    t = load_table()
    new = t["map"].get(digest(source))
    return t["text"].get(new) if new else None


def transform(lines: list[str]) -> list[str]:
    try:
        new = sync_text("".join(lines))
        if new is None:
            return lines
        _STATE["replaced"].append(digest("".join(lines)))
        banner = "print('🔄 هذه الخلية نسخة قديمة — شُغِّلت نسخة المستودع الحالية منها (مزامنة الخلايا)')\n"
        return (banner + new.strip("\n") + "\n").splitlines(keepends=True)
    except Exception:
        return lines  # never break a cell because of the sync


def install() -> bool:
    if os.environ.get("SHAM_NO_CELL_SYNC"):
        return False
    try:
        ip = get_ipython()  # noqa: F821  (defined inside IPython/Kaggle only)
    except NameError:
        return False
    if ip is None:
        return False
    if transform not in ip.input_transformers_cleanup:
        ip.input_transformers_cleanup.append(transform)
    return True


if __name__ == "__main__":
    if "--build" in sys.argv:
        t = build()
        TABLE_PATH.write_text(json.dumps(t, ensure_ascii=False), encoding="utf-8")
        print(f"cell updates: {len(t['map'])} old versions → {len(t['text'])} current cells, {TABLE_PATH.stat().st_size // 1024} KB")
        sys.exit(0)

    old = ["x = 1\n", "print('a')\nprint('b')\n", "keep = True\n"]
    new = ["x = 1\n", "print('a')\nprint('b')\nprint('c')\n", "keep = True\n", "extra = 0\n"]
    assert align(old, new) == {0: 0, 1: 1, 2: 2}
    _STATE["table"] = {"map": {digest(old[1]): digest(new[1])}, "text": {digest(new[1]): new[1]}}
    assert sync_text(old[1]) == new[1] and sync_text("print('mine')") is None and sync_text(new[1]) is None
    out = transform(old[1].splitlines(keepends=True))
    assert "".join(out).endswith("print('c')\n") and "مزامنة" in out[0]
    assert transform(["something else\n"]) == ["something else\n"]

    # a real IPython shell: the old cell text runs as the new cell
    from IPython.core.interactiveshell import InteractiveShell
    shell = InteractiveShell.instance()
    shell.user_ns["get_ipython"] = lambda: shell
    globals()["get_ipython"] = lambda: shell
    assert install() and install()
    assert shell.input_transformers_cleanup.count(transform) == 1
    res = shell.run_cell("seen = []\n")
    shell.run_cell("print('a')\nprint('b')\n")
    # (the replaced cell prints a, b, c after the banner) — check through a variable instead:
    _STATE["table"] = {"map": {digest("v = 1\n"): digest("v = 2\n")}, "text": {digest("v = 2\n"): "v = 2\n"}}
    shell.run_cell("v = 1\n")
    assert shell.user_ns["v"] == 2, shell.user_ns.get("v")
    shell.run_cell("v = 5\n")
    assert shell.user_ns["v"] == 5  # a cell that is not an old published version is never touched
    print("sham_cell_sync self-test OK")
