"""
Sham — قراءة مجموعات التعليمات التي ما زالت تعتمد على سكربت تحميل.

المشكلة (2026-10-16): مصدر `bactrian_ar` في دفتر SFT العربي كان يرجع 0 صفوف
لأن مكتبة datasets الحديثة ترفض سكربتات التحميل:
    RuntimeError: Dataset scripts are no longer supported, but found Bactrian-X.py

الحل (إضافي فقط، لا يغيّر أي مصدر آخر ولا أي إعداد للنموذج): نغلّف
`datasets.load_dataset` مرة واحدة. أي طلب لمجموعة مسجّلة في SCRIPT_REPOS يجرَّب
أولاً كما هو؛ فإن رُفض بسبب السكربت، نقرأ نفس اللغة من نسخة parquet الجاهزة
على الهب، ثم من ملفات json.gz الأصلية كاحتياط. الأعمدة نفسها
(instruction / input / output / id) فلا يتغيّر المستخرج في الدفتر.

يُفعَّل تلقائياً عند استيراد sham_inputs (الذي يستورده الدفتر قبل خلية البيانات)،
فتلتقطه الجلسة القادمة بلا تعديل على الدفتر. إيقافه: SHAM_HUB_COMPAT=0.
"""

from __future__ import annotations

import os

# repo -> (نمط ملفات parquet المحوّلة لكل لغة، نمط ملف json.gz الأصلي لكل لغة)
SCRIPT_REPOS = {
    "MBZUAI/Bactrian-X": (
        "hf://datasets/MBZUAI/Bactrian-X@refs%2Fconvert%2Fparquet/{name}/{split}/*.parquet",
        "hf://datasets/MBZUAI/Bactrian-X/data/{name}.json.gz",
    ),
}


def _is_script_error(exc: Exception) -> bool:
    msg = str(exc)
    return "Dataset scripts are no longer supported" in msg or ".py" in msg and "script" in msg.lower()


def install() -> bool:
    if os.environ.get("SHAM_HUB_COMPAT", "1") == "0":
        return False
    try:
        import datasets
    except Exception:
        return False
    if getattr(datasets.load_dataset, "_sham_hub_compat", False):
        return True
    orig = datasets.load_dataset

    def load_dataset(path, name=None, *args, **kwargs):
        spec = SCRIPT_REPOS.get(path) if isinstance(path, str) else None
        if spec is None or not name:
            return orig(path, name, *args, **kwargs)
        try:
            return orig(path, name, *args, **kwargs)
        except Exception as exc:
            if not _is_script_error(exc):
                raise
            first = exc
        split = kwargs.pop("split", None) or (args[0] if args else None) or "train"
        streaming = kwargs.get("streaming", False)
        parquet_pat, json_pat = spec
        last = first
        for builder, pattern in (("parquet", parquet_pat), ("json", json_pat)):
            try:
                files = pattern.format(name=name, split=split)
                ds = orig(builder, data_files={split: files}, split=split, streaming=streaming)
                print(f"ℹ {path}/{name}: قراءة بديلة عبر {builder}")
                return ds
            except Exception as exc:  # جرّب البديل التالي
                last = exc
        raise last

    load_dataset._sham_hub_compat = True
    datasets.load_dataset = load_dataset
    return True
