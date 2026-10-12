"""
How do the owner's Kaggle notebooks compare with the repository, cell by cell? (read-only)

Cell sync replaces a cell of an imported notebook only when its text is a version of that cell known from the repository history, and only for cells
that run AFTER `import sham_inputs` (that import installs the sync). The engineer edits these notebooks and adds cells (owner's standing rule), so a
cell that matches no repository version is normal and is kept untouched; when a replaced cell needs a name an edited cell no longer defines, the
sync runs the repository's earlier cell first. This pulls every Sham notebook from Kaggle and prints, per notebook, how many cells are current, how many
will be replaced, and how many are the engineer's. Output uses track names and an alias number only, never the
real notebook names, and never prints code.

  python sham_cell_audit.py [workdir]            (needs KAGGLE_USERNAME / KAGGLE_API_TOKEN)
Offline self-test without credentials: python sham_cell_audit.py
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "scripts"))
sys.path.insert(0, str(HERE.parent / "colab" / "sham_small"))
import sham_cell_sync as cs  # noqa: E402

NB_DIR = HERE.parent / "colab" / "sham_small" / "kaggle_notebooks"
TRACK_FILE = {
    "image_tokenizer": "sham_image_tokenizer_track", "audio_tokenizer": "sham_audio_tokenizer_track", "video_corpus": "sham_video_tokenizer_track",
    "cpu_training_track": "sham_cpu_training_track", "research_track": "sham_cpu_research_track", "chat_stage": "sham_chat_stage",
    "stage2_multimodal": "sham_small_training_stage2_multimodal", "text_stage1": "sham_small_training", "live_trainer": "sham_live_trainer",
}


def classify(kaggle_cells: list[str], current: list[str], table: dict) -> dict:
    """Per-cell status of an imported notebook against the repository: current | sync | unknown, plus which old cells run before the sync exists."""
    cur = {cs.digest(c) for c in current}
    status = []
    for c in kaggle_cells:
        h = cs.digest(c)
        status.append("current" if h in cur else "sync" if h in table["map"] else "unknown")
    first_import = next((i for i, c in enumerate(kaggle_cells) if "sham_inputs" in c), len(kaggle_cells))
    stuck = [i for i, s in enumerate(status) if s != "current" and i <= first_import]      # the importing cell itself runs before the sync exists
    return {"status": status, "first_import": first_import, "stuck": stuck,
            "unknown": [i for i, s in enumerate(status) if s == "unknown"]}


def report(track: str, n: int, r: dict) -> str:
    st = r["status"]
    # cells that match no repository version are the engineer's edits/additions: they are kept as they are (owner's standing rule); a replaced cell
    # that needs a name one of them no longer defines gets the repository's earlier cell run first (sham_cell_sync.with_prerequisites)
    return (f"{track} #{n} | خلايا {len(st)} | حالية {st.count('current')} | ستُبدَّل {st.count('sync')} | معدّلة/مضافة من المهندس {st.count('unknown')} {r['unknown']} "
            f"| قبل تثبيت المزامنة (تعمل كما هي) {r['stuck']} | ✅ لا يُعاد استيراده؛ تُترك خلايا المهندس والمزامنة تعالج ما تحتاجه الخلية الجديدة")


def main(workdir: Path) -> int:
    import sham_registry as reg
    from kaggle.api.kaggle_api_extended import KaggleApi
    api = KaggleApi()
    api.authenticate()
    api = reg.RateLimitedApi(api, min_interval=2.0, retries=8)
    table = cs.load_table()
    counts: dict[str, int] = {}
    for k in reg.list_all_kernels(api):
        ref = reg._get(k, "ref")
        if not ref:
            continue
        try:
            source, _meta = reg.pull_source(api, ref, workdir)
        except Exception:
            continue
        track = reg.identify_track(source, reg._get(k, "title", default="") or "")
        name = TRACK_FILE.get(track or "")
        if not name:
            continue
        d = workdir / ref.replace("/", "__")
        files = sorted(d.glob("*.ipynb"))
        if not files:
            continue
        kaggle_cells = cs._code_cells(json.loads(files[0].read_text(encoding="utf-8")))
        current = cs._code_cells(json.loads((NB_DIR / f"{name}.ipynb").read_text(encoding="utf-8")))
        counts[track] = counts.get(track, 0) + 1
        print(report(track, counts[track], classify(kaggle_cells, current, table)), flush=True)
    return 0


def _self_test() -> None:
    table = {"map": {cs.digest("old collect()"): cs.digest("new collect()")}, "text": {}}
    current = ["import os", "import sham_inputs", "new collect()", "new train()"]
    ok = classify(current, current, table)
    assert ok["stuck"] == [] and ok["unknown"] == []
    half = classify(["import os", "import sham_inputs", "old collect()", "someone hand-edited this"], current, table)
    assert half["status"] == ["current", "current", "sync", "unknown"] and half["unknown"] == [3] and half["stuck"] == []
    stuck = classify(["import os", "old collect()", "import sham_inputs", "new train()"], current, table)
    assert stuck["stuck"] == [1], stuck          # an old cell that runs before sham_inputs is imported can never be replaced
    assert "المهندس" in report("t", 1, half) and "⚠" not in report("t", 1, stuck)
    print("sham_cell_audit self-test OK")


if __name__ == "__main__":
    if not (os.environ.get("KAGGLE_API_TOKEN") or os.environ.get("KAGGLE_KEY")):
        _self_test()
        sys.exit(0)
    sys.exit(main(Path(sys.argv[1]) if len(sys.argv) > 1 else Path(tempfile.mkdtemp())))
