"""Build the focused STAGE notebooks of a Sham v2 lineage from the full v2 notebook (so they never drift from it).

Why stages (owner 2026-11-08: divide the training between the Shams by each one's state, ability and tools): measured on the transplanted body, Sham v2 writes good Arabic and answers
facts but calls NO tool correctly (0/6) and has untrained image/audio rows. Those are two different jobs with different data and different cost:

  sham_v2_tools_train.ipynb   TOOLS stage  : the 49 tools and their workflows (coverage guarantee, skills, plans, patch+test, fix flows), identity, a little Arabic replay. No media
                                              collection, no media tokenizers: a short, cheap session whose result is measured by measure_tools (100 cases) and the gate.
  sham_v2_media_train.ipynb   MEDIA stage  : image/audio pairs (the stage-2 collectors) with a small tools replay so the calls are not forgotten; measured by measure_link.
  sham_v2_train.ipynb         ALL (existing): the whole mix (text, code, reasoning, evidence reading, tools, media) in one session.

All three train the SAME lineage and publish to the same checkpoint dataset, one at a time: a notebook publishes only if nobody published since it started (V.published_step) and only
if the merge gate passes. For the candidate-donor lineage the same notebooks are derived with its donor and dataset (make_candidate.py).
Usage: python make_stage_notebooks.py  (rewrites ../sham_v2_tools/ and ../sham_v2_media/ and the candidate's tools notebook)."""
from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
KS = HERE.parent
BASE = json.loads((HERE / "sham_v2_train.ipynb").read_text(encoding="utf-8"))
META = json.loads((HERE / "kernel-metadata.json").read_text(encoding="utf-8"))


def code(text: str) -> dict:
    return {"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [], "source": text.splitlines(True)}


def md(text: str) -> dict:
    return {"cell_type": "markdown", "metadata": {}, "source": text.splitlines(True)}


def cell(marker: str) -> dict:
    """The base notebook's cell whose text starts with / contains `marker` (the first match)."""
    for c in BASE["cells"]:
        if marker in "".join(c["source"]):
            return c
    raise KeyError(marker)


def common_head() -> list[dict]:
    return [cell("SHAM_SECRETS_FALLBACK_V3"), cell("SHAM_QUIET_START_V4"), md("### 1) سحب الكود\n"), cell("GITHUB_TOKEN = UserSecretsClient"), md("### 2) المكتبات\n"),
            cell('"pip", "install"'), md("### 3) الإعداد: مفردات المانح\n"), cell("import sham_v2_train as V"), md("### 4) النموذج\n"), cell("V_DS = V.DEFAULT_DATASET"),
            md("### 5) قياس قبل الجلسة (أدوات، خسارة محجوزة، بت/بايت)\n"), cell("N_TOOL_CASES")]


def common_tail() -> list[dict]:
    return [md("### بعد الجلسة: قياس الأدوات\n"), cell("tools_after = V.measure_tools"), md("### الحفظ ثم البوابة ثم النشر (لا نشر إن ساءت القياسات أو نشر دفتر آخر أثناء الجلسة)\n"),
            cell("save_checkpoint(upload_dir"), cell("sham_trigger_restarter")]


STAGE_ENV = 'import os\nos.environ["SHAM_V2_STAGE"] = "{stage}"\n'
TRAIN = '''model.to(device)
HOURS = float(os.environ.get("SHAM_V2_HOURS", "{gpu}" if device == "cuda" else "{cpu}"))
HOURS = min(HOURS, max(0.5, (11.0 * 3600 - (time.time() - SESSION_START) - 40 * 60) / 3600))
losses, final_step = V.run_session(model, start_step, mix, device, HOURS)
print(f"انتهى: {{len(losses):,}} خطوة — الخطوة النهائية {{final_step:,}}")
if losses:
    print(f"الخسارة: أول 10 = {{sum(losses[:10]) / min(10, len(losses)):.4f}} | آخر 10 = {{sum(losses[-10:]) / min(10, len(losses)):.4f}}")
'''
TOOLS_DATA = '''SEED = int(time.time()) // 86400
mix = V.tools_stage_batches(tokenizer, SEED, int(os.environ.get("SHAM_V2_TOOL_EXAMPLES", "4000")), 2, V.arabic_replay_pairs(SEED, 600))
print(f"مرحلة الأدوات: {len(mix):,} دفعة (كل أداة تُستدعى ٣ مرات على الأقل + مسارات العمل + الهوية + إعادة عربية)")
'''
MEDIA_DATA = '''SEED = int(time.time()) // 86400
tool_b = V.tools_stage_batches(tokenizer, SEED, 300, 2)                  # a small replay: the calls learned in the tools stage are not forgotten
mix = list(multimodal_batches) + tool_b
random.Random(SEED).shuffle(mix)
print(f"مرحلة الوسائط: {len(multimodal_batches):,} دفعة وسائط + {len(tool_b):,} إعادة أدوات")
'''


def write(directory: Path, filename: str, slug: str, title: str, cells: list[dict], base_meta: dict) -> None:
    directory.mkdir(exist_ok=True)
    nb = {**BASE, "cells": cells}
    (directory / filename).write_text(json.dumps(nb, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    meta = {**base_meta, "id": slug, "title": title, "code_file": filename}
    (directory / "kernel-metadata.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")


def build() -> None:
    tools = [code(STAGE_ENV.format(stage="tools")), md("# شام v2 — مرحلة الأدوات (الأدوات الـ49 ومسارات عملها)\n")] + common_head() + [
        md("### 6) بيانات الأدوات\n"), code(TOOLS_DATA), md("### 7) التدريب\n"), code(TRAIN.format(gpu="2.0", cpu="6.0"))] + common_tail()
    media = [code(STAGE_ENV.format(stage="media")), md("# شام v2 — مرحلة الوسائط (صور وصوت مع إعادة أدوات صغيرة)\n")] + common_head() + [
        md("### 6) أزواج الوسائط\n"), cell("from sham_data_sources import Ledger, collect"), cell("import json as _json"), cell("import soundfile as sf"),
        cell("from dataset import ImageCaptionDataset"), md("### 7) المزج\n"), code(MEDIA_DATA), md("### 8) قياس الربط ثم التدريب\n"), cell("from sham_media_link import measure_link"),
    ] + common_tail()
    write(KS / "sham_v2_tools", "sham_v2_tools_train.ipynb", "jonsnowjonsnow/sham-v2-tools-train", "sham-v2-tools-train", tools, META)
    write(KS / "sham_v2_media", "sham_v2_media_train.ipynb", "jonsnowjonsnow/sham-v2-media-train", "sham-v2-media-train", media, META)
    # the candidate-donor lineage gets its tools stage too (its weakness is the same: no tool call yet)
    env = [json.loads(json.dumps(c)) for c in tools]
    env[0] = code(STAGE_ENV.format(stage="tools") + 'os.environ["SHAM_V2_DONOR"] = "HuggingFaceTB/SmolLM3-3B"\nos.environ["SHAM_V2_DATASET"] = "sham-v2-candidate-checkpoint"\nos.environ.setdefault("SHAM_V2_DTYPE", "bfloat16")\n')
    write(KS / "sham_v2_candidate_tools", "sham_v2_candidate_tools_train.ipynb", "jonsnowjonsnow/sham-v2-candidate-tools-train", "sham-v2-candidate-tools-train", env, META)
    print("wrote the tools, media and candidate-tools stage notebooks")


if __name__ == "__main__":
    build()
