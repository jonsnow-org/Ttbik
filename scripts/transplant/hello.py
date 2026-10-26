"""What does each model actually answer? Sham's chat path and the donors, on the same few prompts. Read-only.

The bits-per-byte numbers measure how well a model predicts text, not whether it answers a greeting: a base model continues text, only a chat-tuned one replies.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import torch

ROOT = Path(__file__).resolve().parents[2]
SHAM = ROOT / "ai-system" / "colab" / "sham_small"
sys.path.insert(0, str(SHAM))
os.chdir(SHAM)
PROMPTS = ["مرحبا", "كيف حالك؟", "من أنت؟", "اكتب دالة بايثون تجمع رقمين."]


def sham() -> None:
    from checkpoint import load_checkpoint
    from sham_ci_merge import pick_base
    from sham_inputs import fetch_dataset
    from sham_studio_chat import studio_generate
    from text_tokenizer import ShamTextTokenizer

    ckpt, base_dir, label, _p = pick_base(fetch_dataset, probe=None)
    model, step, _ = load_checkpoint(ckpt, map_location="cpu")
    model.train(False)
    tok = ShamTextTokenizer.load(str(sorted(base_dir.rglob("sham_small_tokenizer.json"))[0]))
    print(f"\n=== SHAM {label} step {step} (its own chat path, no web search) ===", flush=True)
    for p in PROMPTS:
        for i in range(2):
            torch.manual_seed(i)
            print(f"[{p}] -> {studio_generate(model, tok, p, max_new_tokens=50, search_fn=None)!r}", flush=True)


def hf(name: str, chat: bool) -> None:
    from transformers import AutoModelForCausalLM, AutoTokenizer
    tok = AutoTokenizer.from_pretrained(name, token=os.environ.get("HF_TOKEN") or None)
    m = AutoModelForCausalLM.from_pretrained(name, dtype=torch.float32, token=os.environ.get("HF_TOKEN") or None).eval()
    print(f"\n=== {name} ({'chat template' if chat else 'raw text continuation'}) ===", flush=True)
    for p in PROMPTS:
        if chat:
            try:
                text = tok.apply_chat_template([{"role": "user", "content": p}], tokenize=False, add_generation_prompt=True, enable_thinking=False)
            except TypeError:
                text = tok.apply_chat_template([{"role": "user", "content": p}], tokenize=False, add_generation_prompt=True)
        else:
            text = p
        ids = tok(text, return_tensors="pt")
        with torch.no_grad():
            out = m.generate(**ids, max_new_tokens=50, do_sample=False, repetition_penalty=1.1)
        print(f"[{p}] -> {tok.decode(out[0, ids['input_ids'].shape[1]:], skip_special_tokens=True)!r}", flush=True)


if __name__ == "__main__":
    try:
        sham()
    except Exception as e:                                                  # noqa: BLE001
        print(f"SHAM failed: {type(e).__name__}: {str(e)[:300]}", flush=True)
    for name, chat in (("Qwen/Qwen3-0.6B-Base", False), ("Qwen/Qwen3-0.6B", True), ("Qwen/Qwen2.5-0.5B-Instruct", True)):
        try:
            hf(name, chat)
        except Exception as e:                                              # noqa: BLE001
            print(f"{name} failed: {type(e).__name__}: {str(e)[:300]}", flush=True)
