"""
Sham v2 training (the lineage whose body is a transplanted chat-tuned donor and whose text vocabulary is the donor's own: SHAM_TEXT_VOCAB).

What a session does, in order (the Kaggle notebook kaggle_notebooks/sham_v2/sham_v2_train.ipynb is thin glue around these functions, so the logic is testable here on a tiny model):
  1. prepare_model():  resume from this lineage's own dataset (sham-v2-checkpoint) or build the native model from the donor (the transplant, in memory).
  2. freeze_for_media(): the donor body stays frozen; media/special embedding rows and low-rank adapters on attention/MLP projections train.
  3. batches: media pairs (the stage-2 collectors, notebook cells) + tool/code/ask examples (sham_tools_data.qwen3_tool_examples, the layout the engine sends)
     + Arabic chat (streamed instruction sets) so the language does not fade.
  4. train() (train.py: fp16 + GradScaler on GPU, wall-clock limit, checkpoints) and measure_tools(): a fixed set of tool cases answered through the SAME guarded
     generation the Studio uses, scored on name + required arguments.
  5. save and publish (notebook cells), with the tokenizer stamp so serve.py accepts it.
GPU when the quota allows, else CPU: train() and the restarter handle the device; nothing here depends on it.
"""
from __future__ import annotations

import json
import os
import random
import time
from pathlib import Path

import torch

DEFAULT_DONOR = os.environ.get("SHAM_V2_DONOR", "Qwen/Qwen3-1.7B")
TEXT_VOCAB_DEFAULT = 151936


def setup_env(text_vocab: int = TEXT_VOCAB_DEFAULT) -> None:
    """Must run BEFORE model.py is imported anywhere (the vocabulary layout is read at import)."""
    os.environ.setdefault("SHAM_TEXT_VOCAB", str(text_vocab))


def prepare_model(donor: str, own_checkpoint: Path | None, device: str):
    """(model, step). Resume from the lineage's own checkpoint when there is one, else the in-memory transplant from the donor."""
    from checkpoint import load_checkpoint
    if own_checkpoint is not None and Path(own_checkpoint).is_file():
        model, step, _ = load_checkpoint(own_checkpoint, map_location="cpu")
        print(f"resumed from {own_checkpoint} (step {step})", flush=True)
    else:
        from sham_transplant import LazyDonor, native_model
        model = native_model(LazyDonor(donor), chat_format="qwen3")
        step = 0
        print(f"built the native model from the donor (step 0, {sum(p.numel() for p in model.parameters()) / 1e9:.2f}B parameters)", flush=True)
    rank = max(0, int(os.environ.get("SHAM_V2_ADAPTER_RANK", "8")))
    if rank:
        wrapped = model.enable_adapters(rank, float(os.environ.get("SHAM_V2_ADAPTER_ALPHA", "16")))
        print(f"enabled {wrapped} trainable low-rank adapters; donor base projections remain frozen", flush=True)
    return model.to(device), step


def freeze_for_media(model, text_vocab: int | None = None) -> int:
    """Freeze everything but the media/special rows of the token table. Returns how many rows are trainable."""
    tv = text_vocab or int(os.environ.get("SHAM_TEXT_VOCAB", TEXT_VOCAB_DEFAULT))
    for p in model.parameters():
        p.requires_grad_(False)
    w = model.token_embedding.weight
    w.requires_grad_(True)
    keep = torch.zeros(w.shape[0], 1, dtype=w.dtype, device=w.device)
    keep[tv:] = 1.0
    w.register_hook(lambda g: g * keep.to(g.device, g.dtype))
    for name, param in model.named_parameters():
        if name.endswith(".adapter_down") or name.endswith(".adapter_up"):
            param.requires_grad_(True)
    return int(w.shape[0] - tv)


def media_optimizer(model, lr: float = 2e-4):
    """AdamW over media rows and low-rank adapters only; donor base projections stay frozen."""
    trainable = [p for p in model.parameters() if p.requires_grad]
    if not trainable:
        raise RuntimeError("Sham v2 training has no trainable parameters")
    return torch.optim.AdamW(trainable, lr=lr, weight_decay=0.0, betas=(0.9, 0.95))


def identity_grounding_pairs() -> list[tuple[str, str]]:
    """Small factual SFT examples for Sham v2's app identity; training data only, never an inference-time fixed reply."""
    return [
        ("من أنت؟", "أنا شام v2، مساعد مستقل داخل تطبيق شام. نوفا مساعد منفصل وليس اسمي."),
        ("هل أنت نوفا؟", "لا، أنا شام v2. نوفا نموذج آخر يعمل بمسار منفصل."),
        ("أنت شام أم نوفا؟", "أنا شام v2، ولست نوفا. لكل نموذج مساره الخاص داخل التطبيق."),
        ("ما الفرق بينك وبين نوفا؟", "نحن نموذجان مختلفان في التطبيق؛ لكل واحد مسار واستدعاء مستقل. اسمي شام v2."),
        ("هل أنت شام القديم؟", "أنا إصدار شام v2، أما شام القديم فهو مسار آخر منفصل."),
        ("ما اسم النموذج الذي تتحدث من خلاله؟", "أنا أعمل بصفتي شام v2، ولا أتحدث باسم نوفا."),
    ]


def tool_batches(tokenizer, n: int, batch_size: int, seed: int, system: str | None = None):
    """Padded (ids, labels) batches of tool / code / ask examples in the engine's own layout."""
    from sham_chat import batch_examples
    from sham_tools_data import qwen3_tool_examples
    ex = qwen3_tool_examples(tokenizer, random.Random(seed), n, system or "")
    return batch_examples(ex, batch_size)


def arabic_pairs_to_batches(tokenizer, pairs: list[tuple[str, str]], batch_size: int, system: str | None = None, max_len: int = 900):
    """(question, answer) pairs -> Qwen3-layout chat batches (loss on the answer only)."""
    from sham_chat import batch_examples
    end = tokenizer.encode("<|im_end|>")[-1]
    ex = []
    for q, a in pairs:
        p = tokenizer.encode(f"<|im_start|>user\n{q}<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n")
        t = tokenizer.encode(a) + [end]
        if len(p) + len(t) <= max_len:
            ex.append((p + t, [-100] * len(p) + t))
    return batch_examples(ex, batch_size)


def _parse_call(text: str):
    import re
    m = re.search(r"<tool_call>\s*(\{.*?\})\s*</tool_call>", text, re.S)
    if not m:
        return None
    try:
        o = json.loads(m.group(1))
        return str(o.get("name", "")), (o.get("arguments") or {})
    except ValueError:
        return None


@torch.no_grad()
def measure_arabic(model, tokenizer, seed: int = 7041) -> dict:
    """Held-out Arabic/code smoke set. Evaluation only; never changes or rewrites inference replies."""
    from sham_studio_chat import qwen3_chat
    import re

    cases = [
        ("ما عاصمة سوريا؟ أجب بالعربية بجملة قصيرة.", "capital"),
        ("اشرح بالعربية باختصار الفرق بين المتغير والدالة في البرمجة.", "arabic"),
        ("اكتب دالة Python تجمع عددين وتعيد الناتج.", "python"),
        ("ما فائدة الاختبارات في مشروع برمجي؟ أجب بالعربية.", "arabic"),
        ("اشرح بالعربية معنى واجهة برمجة التطبيقات API.", "arabic"),
    ]
    rows = []
    for prompt, kind in cases:
        answer = str(qwen3_chat(model, tokenizer, prompt, 100, temperature=0.0, think_tokens=0) or "").strip()
        arabic_chars = len(re.findall(r"[\u0600-\u06FF]", answer))
        letters = len(re.findall(r"[^\W\d_]", answer, flags=re.UNICODE))
        arabic_ratio = arabic_chars / max(1, letters)
        rows.append({
            "kind": kind,
            "arabic_ratio": round(arabic_ratio, 3),
            "capital_syria": kind != "capital" or "دمشق" in answer,
            "python_code": kind != "python" or ("def " in answer and ("return" in answer or "lambda" in answer)),
            "has_arabic": arabic_chars >= 8 and arabic_ratio >= 0.25,
            "answer": answer[:220],
        })
    arabic_rows = [r for r in rows if r["kind"] == "arabic"]
    return {
        "cases": len(rows),
        "arabic_cases": len(arabic_rows),
        "arabic_script": sum(bool(r["has_arabic"]) for r in arabic_rows),
        "capital_syria": bool(rows[0]["capital_syria"]),
        "python_code": bool(rows[2]["python_code"]),
        "rows": rows,
    }


@torch.no_grad()
def measure_tools(model, tokenizer, n_cases: int = 24, seed: int = 4242, max_new: int = 90) -> dict:
    """A fixed set of tool cases (own seed, never trained on: training uses other seeds), answered through the Studio's guarded generation.
    valid = a well-formed call; right = the first call has the expected tool and every expected argument name."""
    from sham_tools_data import any_spec, tool_block, TOOL_SPECS
    rng = random.Random(seed)
    model.train(False)
    valid = right = asked = 0
    rows = []
    for _ in range(n_cases):
        user, steps, _ans = any_spec(rng)
        name, args, _res = steps[0]
        names = list(dict.fromkeys([name] + rng.sample([t for t in TOOL_SPECS if t != name], 4)))
        rng.shuffle(names)
        prompt = f"{tool_block(names)}\n\nالمستخدم: {user}\nشام:"
        out = qwen3_chat(model, tokenizer, prompt, max_new)
        call = _parse_call(out)
        ok = call is not None
        good = bool(ok and call[0] == name and set(args) <= set(call[1]))
        valid += ok
        right += good
        asked += bool(ok and call[0] == "ask_user")
        rows.append({"user": user[:60], "expected": name, "got": call[0] if ok else None, "right": good})
    return {"cases": n_cases, "valid": valid, "right": right, "asked": asked, "rows": rows}


def run_session(model, step: int, batches: list, device: str, hours: float, lr: float = 2e-4, ckpt_dir: str = "/kaggle/working/checkpoints") -> tuple[list[float], int]:
    """Train the media table on `batches` for at most `hours`. Returns (losses, final step)."""
    from train import TrainConfig, train
    opt = media_optimizer(model, lr)
    accum = 4
    total = max(len(batches) // accum, 1)
    cfg = TrainConfig(seq_len=model.cfg.max_seq_len, batch_size=1, grad_accum_steps=accum, lr=lr, warmup_steps=max(5, total // 50), total_steps=step + total,
                      checkpoint_dir=ckpt_dir, checkpoint_every=100, log_every=10, max_wall_clock_seconds=hours * 3600)
    losses = train(model, batches, cfg, device=device, start_step=step, resume_optimizer=opt)
    return losses, step + len(losses)


if __name__ == "__main__":
    import tempfile

    setup_env(300)                                              # a tiny text vocabulary for the self-test (set before model.py is imported)
    from checkpoint import load_checkpoint, save_checkpoint
    from model import ShamSmall, ShamSmallConfig, SpecialTokens

    class Tok:
        vocab_size = 300

        def encode(self, t):
            return [3 + (ord(c) % 280) for c in t] if t != "<|im_end|>" else [299]

        def decode(self, ids):
            return "".join(chr(0x0621 + (i % 40)) for i in ids)

    tv = 300
    cfg = ShamSmallConfig(vocab_size=tv + 8192 + 2048 + 16, d_model=32, n_layers=2, n_heads=4, n_kv_heads=2, mlp_hidden=64, max_seq_len=1300)
    model = ShamSmall(cfg)
    model.enable_adapters(4)
    n = freeze_for_media(model, tv)
    assert n == 8192 + 2048 + 16, n
    assert sum(p.requires_grad for p in model.parameters()) > 1
    w0 = model.token_embedding.weight.detach().clone()
    adapter0 = {name: p.detach().clone() for name, p in model.named_parameters() if name.endswith(".adapter_down") or name.endswith(".adapter_up")}
    from sham_chat import batch_examples
    end_id = Tok().encode("<|im_end|>")[-1]
    media_id = tv + 1
    media_batch = batch_examples([([3, media_id, end_id], [-100, media_id, end_id])], 1)
    batches = media_batch + tool_batches(Tok(), 12, 2, seed=1)
    assert len(identity_grounding_pairs()) >= 6 and all(q and a for q, a in identity_grounding_pairs())
    assert batches and all(isinstance(b, tuple) and len(b) == 2 for b in batches)
    with tempfile.TemporaryDirectory() as d:
        losses, final = run_session(model, 0, batches[:4], "cpu", 0.05, ckpt_dir=d)
        assert losses and all(torch.isfinite(torch.tensor(l)) for l in losses)
        w1 = model.token_embedding.weight.detach()
        assert torch.equal(w0[:tv], w1[:tv]), "a donor text row changed"
        assert not torch.equal(w0[tv:], w1[tv:]), "the media rows did not train"
        assert any(not torch.equal(adapter0[name], p.detach()) for name, p in model.named_parameters() if name in adapter0), "language/tool adapters did not train"
        save_checkpoint(Path(d) / "x.pt", model, final)
        m2, s2, _ = load_checkpoint(Path(d) / "x.pt", map_location="cpu")
        assert s2 == final and torch.equal(m2.token_embedding.weight, model.token_embedding.weight)
    mt = measure_tools(model, Tok(), n_cases=2, max_new=6)
    assert mt["cases"] == 2 and len(mt["rows"]) == 2 and 0 <= mt["right"] <= mt["valid"] <= 2
    ar = arabic_pairs_to_batches(Tok(), [("ما هي عاصمة سوريا؟", "دمشق."), ("كيف حالك؟", "بخير، شكراً.")], 2)
    assert ar
    print("sham_v2_train self-test OK: media rows and low-rank adapters train; donor base remains frozen; role-based tool/Arabic batches and checkpoint round-trip.")
