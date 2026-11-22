#!/usr/bin/env python3
"""Exact budgets of a T-LDM model: parameters (== , never a range), FLOPs measured from the real forward (not estimated), and the honest autoregressive comparison.

Rules taken from a corrected engineering spec we reviewed (2026-11-21), applied to OUR model:
  * every number is either derived by a formula shown here, or measured by running the model; a count is asserted with `==`, so any change of width, depth or vocabulary is visible at once;
  * tied weights are counted once (torch's parameters() already de-duplicates);
  * FLOPs = 2 x MACs; attention scores (QK and AV) are included; the diffusion writer is NOT free: every pass runs the whole block;
  * the saving of a block writer over an autoregressive writer is only meaningful against an autoregressive writer WITH a KV cache. Against one without a cache it looks 3-4x cheaper,
    against one with a cache it costs MORE FLOPs. The block writer can still win wall-clock where the step count (memory reads of the weights) is the limit, not the FLOPs. Both are printed.

    python eval/budget.py --config configs/experiment_0.3b_bpe_v2.yaml [--passes 10,2]
"""
import argparse
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))
import common  # noqa: E402
import torch  # noqa: E402
from torch.utils._python_dispatch import TorchDispatchMode  # noqa: E402
from torch.utils.flop_counter import flop_registry  # noqa: E402


def parameter_report(model) -> dict:
    """Exact count by top-level group. Biases are reported separately (a recount that forgets them is wrong by exactly their sum)."""
    groups, biases = {}, 0
    for name, p in model.named_parameters():                  # named_parameters() lists a shared (tied) tensor once
        g = name.split(".")[0] if "." in name else name
        if g == "core":
            g = ".".join(name.split(".")[:2])
        groups[g] = groups.get(g, 0) + p.numel()
        if name.endswith(".bias"):
            biases += p.numel()
    total = sum(p.numel() for p in model.parameters())
    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    assert total == sum(groups.values()), "group counts must add up to the total"
    return {"total": total, "trainable": trainable, "biases": biases, "groups": groups}


def vocab_dependent_params(cfg: dict) -> int:
    """Formula, checked against the real model in the tests: the input embedding, the writer's own embedding and the writer's output head are each vocab x d, none tied."""
    return 3 * cfg["vocab"] * cfg["d"]


def writer_layer_macs(N: int, m: int, d: int, ffn: int = None) -> int:
    """MACs of ONE nn.TransformerDecoderLayer (batch 1): self-attention over the N block positions, cross-attention to m latents, feed-forward of width ffn (4d here)."""
    ffn = ffn or 4 * d
    self_attn = N * d * 3 * d + 2 * N * N * d + N * d * d
    cross = N * d * d + m * d * 2 * d + 2 * N * m * d + N * d * d
    return self_attn + cross + 2 * N * d * ffn


def writer_pass_flops_formula(N: int, m: int, d: int, layers: int, vocab: int) -> int:
    return 2 * (layers * writer_layer_macs(N, m, d) + N * d * vocab)


class _Count(TorchDispatchMode):
    """Counts FLOPs of the real run with PyTorch's own per-op formulas (matmuls, attention). It does not use the module tracker, so it also works inside torch.no_grad()."""

    def __init__(self):
        super().__init__()
        self.total = 0

    def __torch_dispatch__(self, func, types, args=(), kwargs=None):
        kwargs = kwargs or {}
        out = func(*args, **kwargs)
        f = flop_registry.get(getattr(func, "overloadpacket", None))
        if f is not None:
            self.total += int(f(*args, **kwargs, out_val=out))
        return out


def measured_flops(fn) -> int:
    """nn.MultiheadAttention has a fused inference fast path that PyTorch's FLOP formulas do not know (it would silently under-count by ~30%): it is switched off while counting."""
    was = torch.backends.mha.get_fastpath_enabled()
    torch.backends.mha.set_fastpath_enabled(False)
    try:
        with _Count() as c:
            fn()
    finally:
        torch.backends.mha.set_fastpath_enabled(was)
    return c.total


def ar_kv_flops(tokens: int, d: int, layers: int, non_embedding_params: int, vocab: int, ctx: int) -> int:
    """Autoregressive writer WITH a KV cache: each new token costs 2 x (non-embedding weights) + attention over the cache (QK and AV) + the output head."""
    return tokens * (2 * non_embedding_params + layers * 4 * d * ctx + 2 * d * vocab)


def init_loss_check(loss: float, K: int, tol: float = 0.25) -> dict:
    """A uniform K-way guess costs ln(K) nats. The first loss of a fresh model must be near it; far away means mis-scaled loss, misaligned vocabulary or a wrong tokenizer."""
    ref = math.log(K)
    return {"loss": round(loss, 4), "ln_K": round(ref, 4), "ratio": round(loss / ref, 3), "ok": abs(loss / ref - 1) <= tol}


def main():
    from sham_tldm import Sham1_TLDM
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default=os.path.join(common.ROOT, "configs", "experiment_0.3b_bpe_v2.yaml"))
    ap.add_argument("--passes", default="10,2")
    ap.add_argument("--vocab", type=int, default=0, help="override (the BPE size is only known after the tokenizer is trained)")
    a = ap.parse_args()
    cfg = common.load_config(a.config)
    vocab = a.vocab or cfg.get("vocab", 257)
    m = Sham1_TLDM(d=cfg["d"], layers=cfg["layers"], latents=cfg["latents"], think_steps=cfg["think_steps"], block=cfg["block"], writer_layers=cfg["writer_layers"], heads=cfg["heads"],
                   bitnet=cfg["bitnet"], in_len=cfg["in_len"], vocab=vocab).eval()
    rep = parameter_report(m)
    print(f"parameters: {rep['total']:,} (trainable {rep['trainable']:,}, biases {rep['biases']:,}); vocab-dependent by formula 3 x V x d = {vocab_dependent_params(m.cfg):,}")
    for g, n in sorted(rep["groups"].items(), key=lambda kv: -kv[1]):
        print(f"  {g:28s} {n:>12,}  {100 * n / rep['total']:5.1f}%")
    ids = torch.randint(1, 255, (1, cfg["in_len"]))
    N, d, L = cfg["block"], cfg["d"], cfg["writer_layers"]
    non_emb = rep["total"] - 3 * vocab * d
    for steps in [int(x) for x in a.passes.split(",")]:
        fl = measured_flops(lambda: m.generate(ids, steps=steps))
        ar = ar_kv_flops(N, d, cfg["layers"] + L, non_emb, vocab, cfg["in_len"])
        print(f"T-LDM block of {N} tokens, {steps} passes: {fl/1e9:7.3f} GFLOPs measured ({fl/N/1e6:7.2f} MFLOPs per block position); "
              f"AR with KV cache of the same size, {N} tokens: {ar/1e9:7.3f} GFLOPs -> T-LDM costs {fl/ar:5.1f}x the FLOPs of cached AR")
    print("FLOPs are not wall-clock: batch-1 CPU decoding is limited by weight reads; see docs/experiments/TLDM_WRITER_SPEED_NOTES.md for measured tok/s.")


if __name__ == "__main__":
    main()
