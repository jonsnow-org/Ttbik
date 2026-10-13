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


SECTION_MARK = "# SHAM_SECTION:"


def _gate(lines: list[str]) -> list[str]:
    """IPython input transformer: a cell whose first line is `# SHAM_SECTION: <name>` runs only when <name> is in SHAM_ACTIVE_SECTIONS (comma list);
    otherwise it is replaced by a one-line notice. This is what lets the all-in-one notebook hold EVERY cell of the notebooks it combines, visible
    and editable, while one session runs only the sections whose turn it is."""
    import os
    if lines and lines[0].startswith(SECTION_MARK):
        name = lines[0][len(SECTION_MARK):].strip()
        if name not in [x.strip() for x in os.environ.get("SHAM_ACTIVE_SECTIONS", "").split(",")]:
            return [f"print('⏭ قسم {name} ليس دوره في هذه الجلسة — تُتخطى خلاياه')\n"]
    return lines


def install_section_gate() -> bool:
    try:
        ip = _shell()
    except Exception:
        return False
    if _gate not in ip.input_transformers_cleanup:
        ip.input_transformers_cleanup.append(_gate)
    return True


# The "all in one" notebook (owner, 2026-10-12: one big notebook for the fifth seat instead of many). It carries the tracks that are NOT scheduled
# anywhere else — the others each keep their own seat or run inside the image notebook's chain, and two notebooks must never write the same dataset.
# hours = each notebook's own time budget on (cpu, gpu), read from the notebooks themselves (MAX_TRAINING_HOURS / sham_live.run default).
ALL_IN_ONE_STAGES = {
    "sham_live_trainer": (11.0, 7.0),
    "sham_small_training": (8.5, 8.5),
    "sham_small_training_stage2_multimodal": (8.5, 3.5),
}


# The two other combined notebooks (owner, 2026-10-13: three notebooks in all — the big all-in-one, A+B, chat+image). Their sections' own time budgets are
# trimmed by build_all_in_one.GROUPS so that BOTH sections of a notebook fit in one session (they used to be 8.5 + 8.5 h and 11 h + 4.4 h).
AB_STAGES = {
    "sham_cpu_training_track": (5.0, 5.0),
    "sham_cpu_research_track": (5.0, 5.0),
}
CHAT_IMAGE_STAGES = {
    "sham_chat_stage": (6.0, 5.0),
    "sham_image_tokenizer_track": (4.5, 4.5),
}
STAGE_GROUPS = {"all_in_one": ALL_IN_ONE_STAGES, "ab": AB_STAGES, "chat_image": CHAT_IMAGE_STAGES}


def pick_stages(day_ordinal: int, session_hours: float, cuda: bool, stages: dict | None = None) -> list[str]:
    """Which stages this session runs: the order rotates daily so every stage gets its turn; the first always runs, later ones only if their own
    budget still fits in the session (a session is at most 12 hours; the default keeps 1 hour spare)."""
    stages = stages or ALL_IN_ONE_STAGES
    names = sorted(stages)
    start = day_ordinal % len(names)
    order = names[start:] + names[:start]
    picked, used = [], 0.0
    for n in order:
        h = stages[n][1 if cuda else 0]
        if not picked or used + h <= session_hours:
            picked.append(n)
            used += h
    return picked


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
    # rotation: every stage gets a turn; on CPU one long stage fills the session, on GPU two short-enough ones may share it
    first = {pick_stages(d, 11.0, False)[0] for d in range(6)}
    assert first == set(ALL_IN_ONE_STAGES), first
    assert all(len(pick_stages(d, 11.0, False)) == 1 for d in range(6))
    assert any(len(pick_stages(d, 11.0, True)) == 2 for d in range(6)) and all(len(pick_stages(d, 11.0, True)) <= 2 for d in range(6))
    assert pick_stages(5, 1.0, True)[0] in ALL_IN_ONE_STAGES                    # a too-short session still runs one stage (never none)
    print("sham_chain self-test OK")
