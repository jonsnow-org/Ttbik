"""QAT + gradient accumulation on the STREAMING (base-pretraining) path.

Regression for the gap the owner's order exposed: quantization-aware training
was wired into train.py only, while the streaming trainer that the autonomous /
CPU-research notebooks actually use carried no `quant_bits` field at all — so a
notebook passing `StreamTrainConfig(..., quant_bits=4)` died with a TypeError
before training a single step, and the owner's "train on compressed data from
the start" order was silently unmet on the path that learns most of the
knowledge.
"""

from __future__ import annotations

import tempfile
from pathlib import Path

import torch

from model import ShamSmall, ShamSmallConfig
from sham_qat import QuantEmbedding, QuantLinear
from text_tokenizer import train_text_tokenizer
from train_from_stream import StreamTrainConfig, train_from_stream

_SENTENCES = [
    "Sham learns its base knowledge through a real fused stream-to-weights loop.",
    "Quantization-aware training rounds the weights in the forward pass.",
    "The streaming trainer carries the compression setting the owner asked for.",
]


def _mock_stream():
    for i in range(2000):
        yield _SENTENCES[i % len(_SENTENCES)]


def _fixtures():
    with tempfile.TemporaryDirectory() as tmpdir:
        corpus = Path(tmpdir) / "corpus.txt"
        corpus.write_text(" ".join(_SENTENCES) * 50, encoding="utf-8")
        tokenizer = train_text_tokenizer([str(corpus)], vocab_size=500)
    cfg = ShamSmallConfig(vocab_size=42256, d_model=64, n_layers=4, n_heads=4, n_kv_heads=2, mlp_hidden=128, max_seq_len=32)
    return ShamSmall(cfg), tokenizer, cfg


def test_stream_config_accepts_quant_bits_and_grad_accum():
    """The exact call the notebooks make must construct, not raise TypeError."""
    cfg = StreamTrainConfig(seq_len=32, batch_size=2, total_steps=5, grad_accum_steps=4, quant_bits=4)
    assert cfg.quant_bits == 4 and cfg.grad_accum_steps == 4


def test_streaming_qat_wraps_modules_and_preserves_ties():
    model, tokenizer, _ = _fixtures()
    cfg = StreamTrainConfig(seq_len=32, batch_size=4, lr=1e-3, warmup_steps=2, total_steps=6, log_every=100, quant_bits=4)
    losses = train_from_stream(model, _mock_stream(), tokenizer, cfg)
    assert len(losses) == 6
    assert all(torch.isfinite(torch.tensor(l)) for l in losses)
    wrapped = sum(1 for m in model.modules() if isinstance(m, (QuantLinear, QuantEmbedding)))
    assert wrapped > 0, "quant_bits=4 did not wrap any module on the streaming path"
    assert model.lm_head.weight is model.token_embedding.weight, "QAT broke weight tying"


def test_streaming_grad_accum_keeps_optimizer_step_count():
    model, tokenizer, _ = _fixtures()
    cfg = StreamTrainConfig(seq_len=32, batch_size=2, lr=1e-3, warmup_steps=2, total_steps=6, log_every=100, grad_accum_steps=3)
    losses = train_from_stream(model, _mock_stream(), tokenizer, cfg)
    assert len(losses) == 6, "grad_accum_steps changed the optimizer-step count"
