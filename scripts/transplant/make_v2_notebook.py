"""Writes ai-system/colab/sham_small/kaggle_notebooks/sham_v2/{sham_v2_train.ipynb, kernel-metadata.json}.
The notebook is thin glue around ai-system/colab/sham_small/sham_v2_train.py. The media cells are the stage-2 cells of sham_all_in_one.ipynb, copied as they are
(minus the SHAM_SECTION marker line, which would make the registry mistake this notebook for the all-in-one track).   python scripts/transplant/make_v2_notebook.py"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
NB_DIR = ROOT / "ai-system" / "colab" / "sham_small" / "kaggle_notebooks"
OUT = NB_DIR / "sham_v2"
OUT.mkdir(parents=True, exist_ok=True)
allin = json.loads((NB_DIR / "sham_all_in_one.ipynb").read_text(encoding="utf-8"))["cells"]
sft = json.loads((NB_DIR / "arabic_sft" / "sham_arabic_sft.ipynb").read_text(encoding="utf-8"))["cells"]


def src(c):
    return "".join(c["source"])


def strip_marker(text):
    return "\n".join(l for l in text.split("\n") if not l.startswith("# SHAM_SECTION:"))


def md(t):
    return {"cell_type": "markdown", "metadata": {}, "source": t.splitlines(keepends=True)}


def code(t):
    return {"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [], "source": t.splitlines(keepends=True)}


def media_cell(i, must_contain):
    t = strip_marker(src(allin[i]))
    assert must_contain in t, (i, must_contain)
    return t


cells = [
    code(src(sft[0])), code(src(sft[1])),                                  # the secrets / quiet-start cells, as in every Sham notebook
    md("""# شام v2 — تدريب السلالة الجديدة (جسم المانح المنقول + وسائط شام)
دفتر **جديد ومنفصل** (2026-10-26): لا يلمس دفاتر السلالة الحالية ولا مجموعات نقاطها. ينشر إلى مجموعة **جديدة** `sham-v2-checkpoint`.

- الجسم ومفردات النص من المانح كما هي (مجمّدة تماماً). **المدرَّب فقط:** صفوف رموز الصورة (8192) والصوت (2048) والرموز الخاصة، وهي نفسها رأس الإخراج، فبها يتعلم شام أن «يقول» وسائط من رموزه هو.
- الدفعات: أزواج (صورة/صوت ↔ نص) من خلايا المرحلة الثانية نفسها، + أمثلة أدوات وكود وسؤال-عند-النقص بالصيغة التي يرسلها المحرك، + عربي للمحافظة على اللغة.
- القياس قبل وبعد: أدوات (اسم صحيح + معاملات) عبر التوليد المقيَّد نفسه الذي يعمل في الاستوديو، وربط النص بالوسائط (`measure_link`).
- GPU إن سمح الرصيد، وإلا CPU تلقائياً (المراقب يدفعه GPU أولاً)."""),
    md("### 1) سحب الكود"),
    code(src(sft[4])),
    md("### 2) المكتبات"),
    code("""import subprocess
subprocess.run(["pip", "install", "-q", "tokenizers", "soundfile", "safetensors", "transformers", "datasets", "accelerate", "huggingface_hub", "pillow"], check=True)
print("المكتبات جاهزة.")"""),
    md("### 3) الإعداد: مفردات المانح قبل استيراد أي شيء من شام"),
    code("""import time
SESSION_START = time.time()
import os, json, shutil, random
import sham_v2_train as V
V.setup_env()                                   # SHAM_TEXT_VOCAB: يجب أن يسبق استيراد model.py
import torch
from pathlib import Path
device = "cuda" if torch.cuda.is_available() else "cpu"
print(f"الجهاز: {device}")
DONOR = os.environ.get("SHAM_V2_DONOR", V.DEFAULT_DONOR)
from huggingface_hub import hf_hub_download
from text_tokenizer import ShamTextTokenizer
tokenizer = ShamTextTokenizer.load(hf_hub_download(DONOR, "tokenizer.json"))
tokenizer.save("/kaggle/working/sham_small_tokenizer.json")
print(f"مُرمِّز المانح: {tokenizer.vocab_size}")"""),
    md("### 4) النموذج: استئناف من نقطة هذه السلالة، أو التطعيم من المانح في الذاكرة"),
    code("""from sham_inputs import fetch_dataset, publish_dataset
V_DS = "sham-v2-checkpoint"
OWN = fetch_dataset(V_DS)
_own = sorted(OWN.rglob("final_merged.pt")) if OWN else []
model, start_step = V.prepare_model(DONOR, _own[0] if _own else None, device)
STAGE2_OWN = None
print(f"صفوف الوسائط والرموز الخاصة القابلة للتدريب: {V.freeze_for_media(model):,} (الباقي مجمّد)")"""),
    md("### 5) قياس الأدوات قبل الجلسة (التوليد المقيَّد نفسه الذي في الاستوديو)"),
    code("""N_TOOL_CASES = int(os.environ.get("SHAM_V2_TOOL_CASES", "24" if device == "cuda" else "8"))
tools_before = V.measure_tools(model, tokenizer, n_cases=N_TOOL_CASES)
print(f"أدوات قبل: صحيح {tools_before['right']}/{tools_before['cases']} | استدعاء سليم {tools_before['valid']} | ask_user {tools_before['asked']}")"""),
    md("### 6) أزواج الوسائط (جمع وبناء الدفعات: خلايا المرحلة الثانية نفسها)"),
    code(media_cell(57, "collect")),
    code("import torch\n" + media_cell(59, "select_pretrained_tokenizer")),
    code(media_cell(60, "select_pretrained_tokenizer")),
    code(media_cell(62, "MultimodalCollator")),
    md("### 7) أمثلة الأدوات والكود والعربي"),
    code("""SEED = int(time.time()) // 86400                 # بذرة اليوم: أمثلة جديدة كل جلسة، وغير بذرة القياس الثابتة (4242)
tool_b = V.tool_batches(tokenizer, 1600, 2, seed=SEED)
ar_pairs = []
try:
    from datasets import load_dataset
    for name, split, qf, af, flt in (("arbml/CIDAR", "train", "instruction", "output", None), ("CohereLabs/aya_dataset", "train", "inputs", "targets", "Arabic")):
        ds = load_dataset(name, split=split, streaming=True)
        if flt:
            ds = ds.filter(lambda r: flt in (r.get("language") or ""))
        for i, r in enumerate(ds.skip(SEED % 5000)):
            q, a = (r.get(qf) or "").strip(), (r.get(af) or "").strip()
            if q and a:
                ar_pairs.append((q[:600], a[:900]))
            if i >= 1500:
                break
except Exception as _exc:
    print(f"العربي: تخطّي ({type(_exc).__name__}: {str(_exc)[:100]})")
ar_b = V.arabic_pairs_to_batches(tokenizer, ar_pairs, 2) if ar_pairs else []
print(f"دفعات: وسائط {len(multimodal_batches):,} | أدوات {len(tool_b):,} | عربي {len(ar_b):,}")
mix = list(multimodal_batches) + tool_b + ar_b
random.Random(SEED).shuffle(mix)"""),
    md("### 8) قياس الربط قبل الجلسة ثم التدريب (جلسة GPU أقصر حفاظاً على الرصيد)"),
    code("""from sham_media_link import measure_link, link_report
model.to(device)
_media_toks = {"image": image_tokenizer, "audio": audio_tokenizer}
link_before = measure_link(model, tokenizer, _media_toks, FIXED_PAIRS, device)
link_report(link_before)
HOURS = float(os.environ.get("SHAM_V2_HOURS", "3.5" if device == "cuda" else "8.0"))
HOURS = min(HOURS, max(0.5, (11.0 * 3600 - (time.time() - SESSION_START) - 40 * 60) / 3600))
losses, final_step = V.run_session(model, start_step, mix, device, HOURS)
print(f"انتهى: {len(losses):,} خطوة — الخطوة النهائية {final_step:,}")
if losses:
    print(f"الخسارة: أول 10 = {sum(losses[:10]) / min(10, len(losses)):.4f} | آخر 10 = {sum(losses[-10:]) / min(10, len(losses)):.4f}")
link_after = measure_link(model, tokenizer, _media_toks, FIXED_PAIRS, device)
link_report(link_before, link_after)"""),
    md("### 9) قياس الأدوات بعد الجلسة"),
    code("""tools_after = V.measure_tools(model, tokenizer, n_cases=N_TOOL_CASES)
print(f"أدوات بعد: صحيح {tools_after['right']}/{tools_after['cases']} | استدعاء سليم {tools_after['valid']} | ask_user {tools_after['asked']}")
for r in tools_after["rows"][:6]:
    print("  ", r)"""),
    md("### 10) الحفظ مع بصمة المُرمِّز، والتحقق من أنها تُقبل، ثم النشر إلى `sham-v2-checkpoint`"),
    code("""from checkpoint import save_checkpoint
from sham_tok_id import stamp, resolve
import json as _json
upload_dir = Path("/kaggle/working/for_dataset_upload")
if upload_dir.exists():
    shutil.rmtree(upload_dir)
upload_dir.mkdir(parents=True)
extra = {"native_tokenizer": True, **stamp(tokenizer)}
save_checkpoint(upload_dir / "final_merged.pt", model, final_step, extra=extra)
shutil.copy2("/kaggle/working/sham_small_tokenizer.json", upload_dir / "sham_small_tokenizer.json")
for _f in ("image_tokenizer.pt", "audio_tokenizer.pt"):
    shutil.copy2(Path("/kaggle/working") / _f, upload_dir / _f)
for _ledger in Path("/kaggle/working/checkpoints").glob("*_ledger.json"):
    shutil.copy2(_ledger, upload_dir / _ledger.name)
_saved = torch.load(upload_dir / "final_merged.pt", map_location="cpu", weights_only=False)
_path, _note = resolve(_saved.get("extra"), upload_dir / "sham_small_tokenizer.json")
assert _path == str(upload_dir / "sham_small_tokenizer.json") and _note.startswith("ok"), _note        # serve.py would accept it
del _saved
_hist = []
if OWN:
    _hp = sorted(OWN.rglob("v2_history.json"))
    if _hp:
        _hist = _json.loads(_hp[0].read_text(encoding="utf-8"))
_hist.append({"step": final_step, "device": device, "donor": DONOR, "tools_before": {k: v for k, v in tools_before.items() if k != "rows"},
              "tools_after": {k: v for k, v in tools_after.items() if k != "rows"}, "train_loss_last": losses[-20:] if losses else []})
(upload_dir / "v2_history.json").write_text(_json.dumps(_hist, ensure_ascii=False, default=float), encoding="utf-8")
print("بصمة المُرمِّز:", _note)
publish_dataset(upload_dir, V_DS, f"sham v2 at step {final_step:,}")"""),
    code(src(allin[69])),
]

nb = {"cells": cells, "metadata": {"kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"}, "language_info": {"name": "python"}}, "nbformat": 4, "nbformat_minor": 5}
(OUT / "sham_v2_train.ipynb").write_text(json.dumps(nb, ensure_ascii=False, indent=1), encoding="utf-8")
meta = {
    "id": "jonsnowjonsnow/sham-v2-train", "title": "sham-v2-train", "code_file": "sham_v2_train.ipynb", "language": "python", "kernel_type": "notebook",
    "is_private": True, "enable_gpu": True, "enable_internet": True,
    "dataset_sources": ["jonsnowjonsnow/sham-runtime-creds", "jonsnowjonsnow/sham-image-tokenizer-checkpoint", "jonsnowjonsnow/sham-audio-tokenizer-checkpoint"],
    "competition_sources": [], "kernel_sources": [],
}
(OUT / "kernel-metadata.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
print("wrote", OUT, len(cells), "cells")
