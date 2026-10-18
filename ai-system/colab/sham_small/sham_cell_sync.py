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
        elif tag == "replace" and i2 - i1 == j2 - j1:
            # the same number of cells on both sides of a changed block: they are the same cells in the same order, however much each was rewritten.
            # (2026-10-12, found on the owner's Kaggle run: a fully rewritten training cell was not paired by similarity, so an imported notebook got
            # the new save cell but kept the OLD training cell, and the two did not fit — AttributeError 'TrainStats' has no 'steps'.)
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
    try:                       # the all-in-one notebook is generated from three others: refresh it first so a source change reaches it (and the table)
        import build_all_in_one
        build_all_in_one.write()
    except ImportError:
        pass
    top = subprocess.check_output(["git", "-C", str(repo), "rev-parse", "--show-toplevel"], text=True).strip()
    rel_dir = os.path.relpath(NOTEBOOKS, top)
    table = {"map": {}, "text": {}}
    for nb_path in sorted(NOTEBOOKS.rglob("*.ipynb")):        # also the notebooks kept in sub-folders (arabic_sft/ ...)
        rel = f"{rel_dir}/{nb_path.relative_to(NOTEBOOKS).as_posix()}".replace("\\", "/")
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


def _scope_names(src: str) -> tuple[set, set]:
    """(names the cell reads from the notebook's global scope without defining them itself, names it defines at the top level)."""
    import symtable
    top = symtable.symtable(src, "<cell>", "exec")
    used: set = set()
    defined: set = set()

    def walk(t, module: bool) -> None:
        for sym in t.get_symbols():
            name = sym.get_name()
            if module:
                if sym.is_assigned() or sym.is_imported() or sym.is_namespace():
                    defined.add(name)
                elif sym.is_referenced():
                    used.add(name)
            elif sym.is_global() and sym.is_referenced():
                used.add(name)                       # a function or comprehension reading a notebook-level name
        for child in t.get_children():
            walk(child, False)

    walk(top, True)
    return used - defined, defined


def _repo_notebook_cells(text: str) -> tuple[list[str], int] | None:
    """The code cells of the repository notebook that holds this exact cell, and the cell's index (None when no notebook has it)."""
    want = digest(text)
    cache = _STATE.setdefault("nb_cells", {})
    if str(NOTEBOOKS) not in cache:
        cache[str(NOTEBOOKS)] = {}
        for f in sorted(NOTEBOOKS.glob("*.ipynb")):
            try:
                cache[str(NOTEBOOKS)][f.name] = _code_cells(json.loads(f.read_text(encoding="utf-8")))
            except Exception:
                pass
    for cells in cache[str(NOTEBOOKS)].values():
        for i, c in enumerate(cells):
            if digest(c) == want:
                return cells, i
    return None


def with_prerequisites(new: str, known_names: set) -> tuple[str, list[int]]:
    """The engineer edits the owner's notebooks and adds cells (owner's standing rule): a cell we replace may need names that an EARLIER cell used
    to define and that cell was edited, replaced by something else, or deleted. Statically find the names the new cell reads that nothing in the
    kernel defines, take the latest EARLIER cell of the repository notebook that defines each (recursively, a few levels), and put those cells'
    current text in front of the new one. Only missing names trigger it, so a notebook that is consistent runs exactly as before, and the engineer's
    own cells are never removed or rewritten. Returns (text, indexes of the prerequisite cells that were added)."""
    import builtins
    found = _repo_notebook_cells(new)
    if found is None:
        return new, []
    cells, idx = found
    known = set(known_names) | set(dir(builtins))
    chosen: dict[int, str] = {}
    todo = [(idx, new)]
    for _ in range(4):                               # a few levels of "this prerequisite needs another"
        nxt = []
        for at, text in todo:
            needs, _def = _scope_names(text)
            for name in sorted(needs - known - {n for c in chosen.values() for n in _scope_names(c)[1]}):
                for j in range(at - 1, -1, -1):
                    if name in _scope_names(cells[j])[1]:
                        if j not in chosen:
                            chosen[j] = cells[j]
                            nxt.append((j, cells[j]))
                        break
        todo = nxt
        if not todo:
            break
    if not chosen:
        return new, []
    order = sorted(chosen)
    return "\n".join(cells[j].strip("\n") for j in order) + "\n\n" + new.strip("\n") + "\n", order


def transform(lines: list[str]) -> list[str]:
    try:
        new = sync_text("".join(lines))
        if new is None:
            return lines
        _STATE["replaced"].append(digest("".join(lines)))
        banner = "print('🔄 هذه الخلية نسخة قديمة — شُغِّلت نسخة المستودع الحالية منها (مزامنة الخلايا)')\n"
        try:
            ns = get_ipython().user_ns  # noqa: F821
            new, extra = with_prerequisites(new, set(ns))
            if extra:
                banner += (f"print('🧩 الخلية تحتاج متغيرات لم تعد معرّفة (خلية سابقة عُدِّلت أو حُذفت): شُغِّلت قبلها خلايا المستودع رقم {extra}')\n")
        except Exception:
            pass
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
    # a cell rewritten beyond recognition still pairs with its successor when the block has the same number of cells on both sides
    assert align(["a = 1\n", "totally old code here\n"], ["a = 1\n", "import something_else\nprint(99)\n"]) == {0: 0, 1: 1}
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
    # the engineer edited / deleted the earlier cell that defined what a replaced cell needs: the repository's version of that cell runs first
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        nbdir = Path(td)
        cells_new = ["BASE = 10\nITEMS = [BASE, 2]\n", "import math\nTOTAL = sum(ITEMS) + math.floor(1.5)\n", "RESULT = TOTAL * 2\n"]
        (nbdir / "n.ipynb").write_text(json.dumps({"cells": [{"cell_type": "code", "source": c} for c in cells_new]}), encoding="utf-8")
        old_dir, NOTEBOOKS = NOTEBOOKS, nbdir
        _STATE["nb_cells"] = {}
        text, extra = with_prerequisites(cells_new[2], {"os"})
        assert extra == [0, 1] and "BASE = 10" in text and "TOTAL = sum" in text, (extra, text)      # the chain: RESULT needs TOTAL needs ITEMS
        text2, extra2 = with_prerequisites(cells_new[2], {"TOTAL"})
        assert extra2 == [] and text2 == cells_new[2]                                             # nothing missing: the cell runs exactly as it was
        # for real, in the shell: the engineer's cell defined something else, so ITEMS and TOTAL do not exist when the replaced cell runs
        _STATE["table"] = {"map": {digest("RESULT = 0\n"): digest(cells_new[2])}, "text": {digest(cells_new[2]): cells_new[2]}}
        shell.run_cell("ENGINEER_ADDED = 'kept'\n")
        shell.run_cell("RESULT = 0\n")
        assert shell.user_ns["RESULT"] == 2 * (10 + 2 + 1), shell.user_ns.get("RESULT")
        assert shell.user_ns["ENGINEER_ADDED"] == "kept"                                          # the engineer's own cell was never touched
        NOTEBOOKS = old_dir
        _STATE["nb_cells"] = {}
    print("sham_cell_sync self-test OK")
