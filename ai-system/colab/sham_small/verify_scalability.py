"""
Real, executed proof of the four "future expansion" properties added to
model.py — owner spec: "احرص على ان تكون بنية النموذج بشكل كامل تقبل
التوسع من اجل المستقبل" (make sure the architecture fully supports
future expansion). Each of these is verified against real torch
behavior, not just written and assumed correct:

  1. KV-cache correctness: generating token-by-token with a growing
     cache must produce EXACTLY the same logits as a single full-
     sequence forward pass over the same tokens — a cache that silently
     used the wrong RoPE offset or wrong past-length would still run
     without error, just compute the wrong answer, which only a direct
     numerical comparison against the no-cache path can catch.
  2. Gradient checkpointing correctness: turning it on must not change
     the computed loss (it only changes what's stored for backward, not
     the forward math) — checked by comparing losses with the exact
     same weights and inputs, both with and without checkpointing.
  3. Config serialization round trip: to_dict()/from_dict() must
     reconstruct an identical config — the mechanism a future, larger
     checkpoint will rely on to know its own shape without guessing.
  4. Context extension: resize_max_seq_len() must let the model process
     a sequence longer than its original max_seq_len, with zero change
     to any learned weight (only the RoPE buffers, which are computed,
     not learned, change).
"""

import copy

import torch

from model import ShamSmallConfig, ShamSmall


def verify_kv_cache() -> None:
    torch.manual_seed(0)
    cfg = ShamSmallConfig(vocab_size=256, d_model=64, n_layers=4, n_heads=4, n_kv_heads=2, mlp_hidden=128, max_seq_len=64)
    model = ShamSmall(cfg)
    model.eval()

    batch, seq_len = 2, 12
    input_ids = torch.randint(0, cfg.vocab_size, (batch, seq_len))

    with torch.no_grad():
        full_logits, _ = model(input_ids)  # no cache: one shot over the whole sequence

        # Now feed the SAME tokens one at a time through the cache and
        # collect the logits at each step — this must match full_logits
        # position for position if the cache's RoPE offsets and past-kv
        # bookkeeping are correct.
        cached_logits = []
        past_key_values = None
        for t in range(seq_len):
            step_input = input_ids[:, t : t + 1]
            step_logits, _, past_key_values = model(step_input, past_key_values=past_key_values, use_cache=True)
            cached_logits.append(step_logits)
        cached_logits = torch.cat(cached_logits, dim=1)

    max_diff = (full_logits - cached_logits).abs().max().item()
    assert torch.allclose(full_logits, cached_logits, atol=1e-4), (
        f"KV-cache logits diverge from the no-cache full pass by {max_diff:.2e} — "
        f"the cache's RoPE offset or past-length bookkeeping is wrong"
    )
    print(f"KV-cache OK: token-by-token cached generation matches the full-sequence forward pass exactly "
          f"(max diff {max_diff:.2e}).")


def verify_gradient_checkpointing() -> None:
    torch.manual_seed(1)
    cfg = ShamSmallConfig(vocab_size=256, d_model=64, n_layers=4, n_heads=4, n_kv_heads=2, mlp_hidden=128, max_seq_len=64)
    model_plain = ShamSmall(cfg)
    model_ckpt = copy.deepcopy(model_plain)
    model_ckpt.cfg.use_gradient_checkpointing = True

    batch, seq_len = 2, 12
    input_ids = torch.randint(0, cfg.vocab_size, (batch, seq_len))
    labels = input_ids.clone()

    _, loss_plain = model_plain(input_ids, labels=labels)
    _, loss_ckpt = model_ckpt(input_ids, labels=labels)
    assert torch.allclose(loss_plain, loss_ckpt, atol=1e-5), (
        f"gradient checkpointing changed the forward loss ({loss_plain.item():.6f} vs {loss_ckpt.item():.6f}) "
        f"— it must only change what's stored for backward, never the computed values"
    )

    loss_plain.backward()
    loss_ckpt.backward()
    for (name, p_plain), (_, p_ckpt) in zip(model_plain.named_parameters(), model_ckpt.named_parameters()):
        assert p_plain.grad is not None and p_ckpt.grad is not None, f"missing gradient for {name}"
        assert torch.allclose(p_plain.grad, p_ckpt.grad, atol=1e-4), f"gradient mismatch for {name}"
    print(f"gradient checkpointing OK: identical loss ({loss_plain.item():.4f}) and identical gradients "
          f"with vs. without checkpointing.")


def verify_config_roundtrip() -> None:
    cfg = ShamSmallConfig(vocab_size=999, d_model=128, n_layers=3, n_heads=4, n_kv_heads=2, mlp_hidden=256, use_gradient_checkpointing=True)
    restored = ShamSmallConfig.from_dict(cfg.to_dict())
    assert restored == cfg, f"config did not round-trip: {cfg} != {restored}"
    print(f"config serialization OK: to_dict()/from_dict() round trip is exact ({cfg.to_dict()}).")


def verify_context_extension() -> None:
    torch.manual_seed(2)
    cfg = ShamSmallConfig(vocab_size=256, d_model=64, n_layers=2, n_heads=4, n_kv_heads=2, mlp_hidden=128, max_seq_len=16)
    model = ShamSmall(cfg)

    weights_before = {name: p.detach().clone() for name, p in model.named_parameters()}

    long_input = torch.randint(0, cfg.vocab_size, (1, 32))
    try:
        model(long_input)
        raised = False
    except ValueError:
        raised = True
    assert raised, "model accepted a sequence longer than max_seq_len before resizing — the guard is broken"

    model.resize_max_seq_len(64)
    assert model.cfg.max_seq_len == 64
    logits, _ = model(long_input)  # must work now, with no error
    assert logits.shape == (1, 32, cfg.vocab_size)

    for name, p in model.named_parameters():
        assert torch.equal(weights_before[name], p), f"resize_max_seq_len changed a learned weight: {name}"
    print("context extension OK: resize_max_seq_len() lets the model process a longer sequence "
          "with every learned weight unchanged (only the computed RoPE buffers grew).")


if __name__ == "__main__":
    verify_kv_cache()
    verify_gradient_checkpointing()
    verify_config_roundtrip()
    verify_context_extension()
    print("\nAll scalability checks passed — the architecture is genuinely expansion-ready, not just "
          "documented as such.")
