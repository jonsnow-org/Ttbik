"""
One Kaggle notebook can run several tracks one after another (owner, 2026-10-12).

The free plan runs a few notebooks at once, and a short track scheduled beside a long one leaves its slot idle for hours. A "chain" lets a host
notebook, after finishing its own job, run the code cells of other Sham notebooks in the SAME session — so three short tracks use one slot and the
freed slots go to long jobs.

  run_notebooks(["sham_audio_tokenizer_track", "sham_video_tokenizer_track"], code_dir=CODE_DIR)

Each notebook's code cells run in order through the kernel's own IPython shell, exactly as they would in their own session: Kaggle secrets,
`!`/`%` lines, publishing to their own datasets all work as before. The namespace is shared with the host, which is safe because every notebook
defines its own variables in its own first cells (a notebook that relied on another's variable would already fail standalone). A failure in one notebook is printed and the
chain goes on to the next (one broken track must not stop the others). Markdown cells are skipped. The notebooks are read from the repository
clone the host already made, so a fix to a track's cells reaches the chain without re-importing anything.

Returns {notebook: "ok" | "failed: <reason>" | "missing"}. Deployment plumbing only: it writes no answers and no rules for the model.
"""
from __future__ import annotations

import json
import time
from pathlib import Path


def _code_cells(path: Path) -> list[str]:
    nb = json.loads(path.read_text(encoding="utf-8"))
    return ["".join(c.get("source", [])) for c in nb.get("cells", []) if c.get("cell_type") == "code"]


def _shell():
    """The running kernel's shell (on Kaggle), or a headless one (self-test). Cells run through IPython itself, the way the notebook would run them."""
    from IPython import get_ipython
    from IPython.core.interactiveshell import InteractiveShell
    return get_ipython() or InteractiveShell.instance()


def run_notebooks(names: list[str], code_dir, log=print) -> dict[str, str]:
    code_dir = Path(code_dir)
    folder = code_dir / "kaggle_notebooks"
    results: dict[str, str] = {}
    for name in names:
        path = folder / f"{name}.ipynb"
        if not path.exists():
            results[name] = "missing"
            log(f"⛓ {name}: الدفتر غير موجود في الكود — يُتخطى")
            continue
        t0 = time.time()
        log(f"⛓ ─── يبدأ {name} داخل نفس الجلسة ───")
        shell = _shell()
        results[name] = "ok"
        for i, src in enumerate(_code_cells(path)):
            res = shell.run_cell(src, store_history=False)         # prints its own traceback; a stopped/failed cell ends this notebook only
            err = res.error_in_exec or res.error_before_exec
            if err is not None:
                results[name] = f"failed at cell {i}: {type(err).__name__}: {str(err)[:140]}"
                break
        log(f"⛓ ─── انتهى {name} ({results[name]}) بعد {(time.time() - t0) / 60:.1f} دقيقة ───")
    return results


if __name__ == "__main__":
    import tempfile

    with tempfile.TemporaryDirectory() as d:
        nbdir = Path(d) / "kaggle_notebooks"
        nbdir.mkdir()

        def nb(cells):
            return json.dumps({"cells": [{"cell_type": t, "source": s.splitlines(True)} for t, s in cells]})

        (nbdir / "a.ipynb").write_text(nb([("markdown", "# skipped"), ("code", "import os\nX = 5"), ("code", "OUT.append(X * 2)")]), encoding="utf-8")
        (nbdir / "boom.ipynb").write_text(nb([("code", "OUT.append('boom-start')\nraise RuntimeError('x')")]), encoding="utf-8")
        (nbdir / "exits.ipynb").write_text(nb([("code", "import sys\nsys.exit(0)")]), encoding="utf-8")
        (nbdir / "c.ipynb").write_text(nb([("code", "OUT.append('c-ran')")]), encoding="utf-8")
        import builtins
        builtins.OUT = []
        res = run_notebooks(["a", "boom", "exits", "nope", "c"], d, log=lambda *_: None)
        assert builtins.OUT == [10, "boom-start", "c-ran"], builtins.OUT          # a failing notebook did not stop the next ones
        assert res["a"] == "ok" and "RuntimeError" in res["boom"] and res["boom"].startswith("failed"), res
        assert res["nope"] == "missing" and res["c"] == "ok", res
        del builtins.OUT
    print("sham_chain self-test OK")
