"""
Builds kaggle_notebooks/sham_all_in_one.ipynb: ONE notebook that really contains every cell of the notebooks it combines (owner, 2026-10-12: "one big
notebook for the fifth seat — it must hold all the cells, not a loader").

Layout: a setup block (clone the repo, install libraries) + a selection cell (which sections run in THIS session, rotating daily) + then, for each
combined notebook, a header, a memory-reset cell and ALL of its cells unchanged. Every code cell gets one extra first line `# SHAM_SECTION: <name>`; the
gate (sham_chain.install_section_gate) turns the cells of a section that is not active into a one-line notice. A reset cell at the start of each section
clears the kernel (like a fresh notebook) so sections never see each other's variables, and frees GPU memory between two sections of one session.

  python build_all_in_one.py            rewrite the notebook from the current sources
  python build_all_in_one.py --check    exit 1 if the committed notebook differs from what the sources produce
`sham_cell_sync.py --build` regenerates it first, so a change to any source notebook reaches the all-in-one (and already-imported copies of it).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).parent
NB_DIR = HERE / "kaggle_notebooks"
OUT = NB_DIR / "sham_all_in_one.ipynb"
SOURCES = [                                   # (notebook file, Arabic title) — must match sham_chain.ALL_IN_ONE_STAGES
    ("sham_live_trainer", "المدرّب الحي — زحف وجمع وترميز وتدريب"),
    ("sham_small_training", "المرحلة الأولى — تدريب النص الأساسي"),
    ("sham_small_training_stage2_multimodal", "المرحلة الثانية — الصورة والصوت مع النص"),
]
MARK = "# SHAM_SECTION:"


def _md(text: str) -> dict:
    return {"cell_type": "markdown", "metadata": {}, "source": text.splitlines(True)}


def _code(text: str) -> dict:
    return {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": text.splitlines(True)}


def _src(cell: dict) -> str:
    s = cell.get("source", "")
    return "".join(s) if isinstance(s, list) else s


INTRO = """# شام — الدفتر الشامل (مقعد واحد بدل ثلاثة دفاتر)

دفتر واحد يحوي **كل خلايا** ثلاثة دفاتر: **المدرّب الحي** (زحف وجمع وترميز وتدريب)، و**المرحلة الأولى** (تدريب النص)، و**المرحلة الثانية** (الصورة والصوت مع النص). كل قسم تحته خلاياه كما هي في دفتره الأصلي.

كل جلسة تشغّل ما يصلح لوقتها: يدور الترتيب يومياً فينال كل قسم دوره، ويعمل قسم ثانٍ في الجلسة ذاتها فقط إن اتسعت ميزانيته الزمنية. خلايا القسم الذي ليس دوره تُتخطى بسطر واحد.

لا يكرّر ما تعمله دفاتر أخرى: دفتر الصورة يشغّل الصوت والفيديو بعده، والمسار A والمسار B والمحادثة تبقى كلٌّ في مقعدها (كاتب واحد لكل مجموعة بيانات).

- **المسرّع:** CPU فيُجدوَل يومياً، أو GPU فيُشغَّل يدوياً (كاكل يرفض جدولة دفتر عليه GPU).
- **Internet:** يجب أن يكون مفعّلاً.
- **الأسرار:** KAGGLE_USERNAME و KAGGLE_KEY و GITHUB_TOKEN. لا يحتاج أي Add Input.
- **الاستئناف:** كل قسم يستأنف تلقائياً من آخر نقطة منشورة.
- لتشغيل قسم بعينه يدوياً: غيّري السطر `FORCE_SECTIONS` في خلية الاختيار.
"""

SELECT = '''import datetime
import os

import torch

import sham_inputs  # يثبّت إصلاحات التدريب المشتركة ويطبّق تحديثات الخلايا
from sham_chain import ALL_IN_ONE_STAGES, install_section_gate, pick_stages

CUDA = torch.cuda.is_available()
FORCE_SECTIONS = []   # مثال: ["sham_small_training"]  — الأقسام: ''' + "%s" + '''
STAGES_TODAY = FORCE_SECTIONS or pick_stages(datetime.date.today().toordinal(), 11.0, CUDA)
os.environ["SHAM_ACTIVE_SECTIONS"] = ",".join(STAGES_TODAY)
install_section_gate()
print("الجهاز:", "GPU" if CUDA else "CPU", "| الأقسام التي تعمل اليوم:", STAGES_TODAY)
'''

RESET = '''get_ipython().run_line_magic("reset", "-f")   # قسم جديد = دفتر جديد: لا متغيرات من قسم سابق
import gc

gc.collect()
try:
    import torch
    torch.cuda.empty_cache()   # يحرّر ذاكرة GPU بين قسمين في جلسة واحدة
except Exception:
    pass
'''


def build(sources=None, nb_dir: Path | None = None) -> dict:
    sources = sources or SOURCES
    nb_dir = nb_dir or NB_DIR
    first = json.loads((nb_dir / f"{sources[0][0]}.ipynb").read_text(encoding="utf-8"))
    clone = next(_src(c) for c in first["cells"] if c["cell_type"] == "code" and "git" in _src(c) and "clone" in _src(c))
    cells = [
        _md(INTRO),
        _md("## 1) سحب الكود الحقيقي من GitHub"),
        _code(clone),
        _md("## 2) تثبيت المكتبات"),
        _code('import subprocess, sys\nsubprocess.run([sys.executable, "-m", "pip", "install", "-q", "av", "soundfile", "tokenizers", "datasets", "kaggle"], check=False)\nprint("تم تجهيز المكتبات.")\n'),
        _md("## 3) ما يعمل اليوم"),
        _code(SELECT % ", ".join(name for name, _ in sources)),
    ]
    for name, title in sources:
        nb = json.loads((nb_dir / f"{name}.ipynb").read_text(encoding="utf-8"))
        cells.append(_md(f"---\n# القسم: {title}\n`{name}` — خلاياه أدناه كما هي في دفتره الأصلي."))
        cells.append(_code(f"{MARK} {name}\n" + RESET))
        for c in nb["cells"]:
            if c["cell_type"] == "markdown":
                cells.append(_md(_src(c)))
            elif c["cell_type"] == "code":
                cells.append(_code(f"{MARK} {name}\n" + _src(c)))
    base = {k: v for k, v in first.items() if k != "cells"}
    return {**base, "cells": cells}


def render(nb: dict) -> str:
    return json.dumps(nb, ensure_ascii=False, indent=1) + "\n"


def write() -> None:
    OUT.write_text(render(build()), encoding="utf-8")


def _self_test() -> None:
    import os
    import tempfile

    sys.path.insert(0, str(HERE))
    from IPython.core.interactiveshell import InteractiveShell

    import sham_chain
    assert [n for n, _ in SOURCES] == sorted(sham_chain.ALL_IN_ONE_STAGES, key=[n for n, _ in SOURCES].index) and set(n for n, _ in SOURCES) == set(sham_chain.ALL_IN_ONE_STAGES)

    with tempfile.TemporaryDirectory() as d:
        d = Path(d)

        def nbfile(name, cells):
            (d / f"{name}.ipynb").write_text(json.dumps({"metadata": {}, "nbformat": 4, "nbformat_minor": 5, "cells": cells}), encoding="utf-8")

        clone_cell = _code("import os\nimport subprocess\n# git clone placeholder\nCLONED = 'git clone'\n")
        nbfile("a", [clone_cell, _md("# a"), _code("OUT.append('a1')\nA_ONLY = 1"), _code("OUT.append('a2')")])
        nbfile("b", [clone_cell, _code("OUT.append('b1')\nprint(globals().get('A_ONLY', 'no-leak'))")])
        nb = build([("a", "اختبار أ"), ("b", "اختبار ب")], d)
        # all source cells are present (not a loader): 2 code cells + markdown of a, 1 code of b, plus the clone cell of a inside its section
        codes = [_src(c) for c in nb["cells"] if c["cell_type"] == "code"]
        assert sum(1 for c in codes if "OUT.append('a1')" in c or "OUT.append('a2')" in c or "OUT.append('b1')" in c) == 3
        assert all(c.startswith(MARK) for c in codes[3:]), "every section cell carries its marker"
        # run it for real in a headless IPython: only the active section runs, and sections do not share variables
        shell = InteractiveShell.instance()
        import builtins
        builtins.OUT = []
        os.environ["SHAM_ACTIVE_SECTIONS"] = "a"
        shell.input_transformers_cleanup[:] = [t for t in shell.input_transformers_cleanup if t is not sham_chain._gate]
        sham_chain.install_section_gate()
        for src in codes[3:]:
            shell.run_cell(src.replace("# git clone placeholder", ""), store_history=False)
        assert builtins.OUT == ["a1", "a2"], builtins.OUT
        os.environ["SHAM_ACTIVE_SECTIONS"] = "a,b"
        builtins.OUT = []
        for src in codes[3:]:
            shell.run_cell(src, store_history=False)
        assert builtins.OUT == ["a1", "a2", "b1"], builtins.OUT
        assert "A_ONLY" not in shell.user_ns, "the reset cell must clear the previous section's variables"
        del builtins.OUT
    print("build_all_in_one self-test OK")


if __name__ == "__main__":
    if "--check" in sys.argv:
        ok = OUT.exists() and OUT.read_text(encoding="utf-8") == render(build())
        print("all-in-one is up to date" if ok else "all-in-one is OUT OF DATE: run build_all_in_one.py")
        sys.exit(0 if ok else 1)
    if "--write" in sys.argv or len(sys.argv) == 1:
        if len(sys.argv) == 1:
            _self_test()
        write()
        nb = json.loads(OUT.read_text(encoding="utf-8"))
        print(f"wrote {OUT.name}: {len(nb['cells'])} cells ({sum(1 for c in nb['cells'] if c['cell_type'] == 'code')} code)")
