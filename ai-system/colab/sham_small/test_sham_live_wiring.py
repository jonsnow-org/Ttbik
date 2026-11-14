"""QAT and tool-call training must reach the LIVE trainer (sham_live.py).

The live trainer is what publishes the served v1 checkpoint, and it had neither
quantization-aware training nor any tool-call example — so the served model
could not emit a single tool call, and the compression the owner asked to train
through was applied only after training. These tests pin the two wirings down,
and check the real risk of wrapping weights there: sham_guard's Guard and the
EMA both snapshot parameters BY NAME, so the wrapper swap must keep every name
and the tied embedding/lm_head pair intact.
"""

from __future__ import annotations

from pathlib import Path

import torch

from model import ShamSmall, ShamSmallConfig
from sham_qat import QuantEmbedding, QuantLinear, quantize_

HERE = Path(__file__).resolve().parent


def _tiny_model():
    cfg = ShamSmallConfig(vocab_size=1024, d_model=64, n_layers=4, n_heads=4, n_kv_heads=2, mlp_hidden=128, max_seq_len=32)
    return ShamSmall(cfg)


def test_quantize_keeps_every_parameter_name():
    """Guard/EMA key their snapshots on named_parameters(); the swap must not rename anything."""
    model = _tiny_model()
    before = [n for n, _ in model.named_parameters()]
    wrapped = quantize_(model, bits=4)
    after = [n for n, _ in model.named_parameters()]
    assert wrapped > 0
    assert before == after, f"quantize_ changed parameter names: {set(before) ^ set(after)}"


def test_quantize_keeps_the_tie_and_trains():
    model = _tiny_model()
    quantize_(model, bits=4)
    assert isinstance(model.token_embedding, QuantEmbedding)
    assert isinstance(model.lm_head, QuantLinear)
    assert model.lm_head.weight is model.token_embedding.weight, "tie broken by QAT wrap"

    ids = torch.randint(0, 1024, (2, 16))
    opt = torch.optim.AdamW(model.parameters(), lr=1e-2)
    first = None
    last = None
    for _ in range(8):
        _, loss = model(ids, labels=ids)
        assert torch.isfinite(loss)
        last = loss.item()
        if first is None:
            first = last
        opt.zero_grad()
        loss.backward()
        opt.step()
    assert last < first, "QAT-wrapped model did not learn in a short run"


def test_sham_live_wires_qat_and_tools():
    src = (HERE / "sham_live.py").read_text(encoding="utf-8")
    assert "sham_qat" in src and "quantize_" in src, "sham_live does not enable QAT"
    assert "SHAM_QAT_BITS" in src, "sham_live has no QAT switch"
    # sham_live mixes single tool examples into its pool (tool_examples; make_batches pads them) — tool_batches is the batched form other trainers use
    assert "sham_tools_data" in src and ("tool_examples" in src or "tool_batches" in src), "sham_live does not train on tool calls"
    assert "SHAM_TOOLS_MIX" in src, "sham_live has no tool-share switch"


def test_tool_examples_build_for_the_live_mix():
    import random
    import sham_tools_data as tools
    ex = tools.tool_examples(lambda t: [ord(c) % 1000 for c in t], random.Random(0), 4)
    assert len(ex) >= 2 and all(len(i) == len(l) and any(x != -100 for x in l) for i, l in ex), ex[:1]
