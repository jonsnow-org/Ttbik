"""
Sham Small — model growth. Owner spec: "احرص على ان تكون بنية النموذج
بشكل كامل تقبل التوسع من اجل المستقبل" (make sure the architecture
fully supports future expansion) and the original design goal
("قابل مع التدريب والتطوير للوصول لاكثر من 7B"). ShamSmallConfig
already accepts any size (see model.py's own docstring on that class);
this file is what makes growing an ALREADY-TRAINED small checkpoint
into a larger config keep the learned weights instead of discarding
them and starting over from random initialization — the difference
between months of training being reusable capital versus a sunk cost
every time the owner wants a bigger model.

Two genuinely different guarantees are made here, and each is verified
separately below rather than assumed to both work the same way:

  1. Growing DEPTH ONLY (more transformer layers, everything else the
     same): EXACT function preservation. Each newly added layer's
     output projections (o_proj, down_proj) are zero-initialized, so
     a new layer computes x = x + 0 + 0 = x — a real, standard trick
     (a "zero-init residual branch") for inserting new layers without
     disturbing what the network already computes. The grown model
     produces IDENTICAL output to the original on the same input,
     verified by a direct numeric comparison, not just a shape check.

  2. Growing WIDTH (d_model, mlp_hidden, n_heads) or VOCAB: every
     old, trained weight is copied exactly into the corresponding
     submatrix of the new, larger tensor (verified directly), and any
     new rows/columns get the same random initialization scheme
     model.py's own ShamSmall._init_weights() already uses. This is a
     "warm start," not an exact function-preserving transform — the new
     random dimensions do contribute to the new layers' output
     immediately, unlike net2net's more involved neuron-splitting
     technique — so growing width WILL shift the model's exact outputs
     somewhat and further training is expected to smooth that over,
     but it never throws away a single previously-learned weight, and
     the special case of growing ONLY vocab_size (no width/depth
     change at all) IS exactly function-preserving for every
     already-known token, verified directly below too.
"""

from dataclasses import replace

import torch
import torch.nn as nn

from model import ShamSmall, ShamSmallConfig

_INIT_STD = 0.02  # must match ShamSmall._init_weights() in model.py


def _grow_linear(old: nn.Linear, new_out: int, new_in: int, zero_init: bool = False) -> nn.Linear:
    new_layer = nn.Linear(new_in, new_out, bias=old.bias is not None)
    with torch.no_grad():
        if zero_init:
            new_layer.weight.zero_()
        else:
            nn.init.normal_(new_layer.weight, mean=0.0, std=_INIT_STD)
        old_out, old_in = old.weight.shape
        new_layer.weight[:old_out, :old_in] = old.weight
        if old.bias is not None:
            new_layer.bias.zero_()
            new_layer.bias[:old_out] = old.bias
    return new_layer


def _grow_embedding(old: nn.Embedding, new_num_embeddings: int, new_dim: int) -> nn.Embedding:
    new_emb = nn.Embedding(new_num_embeddings, new_dim)
    with torch.no_grad():
        nn.init.normal_(new_emb.weight, mean=0.0, std=_INIT_STD)
        old_num, old_dim = old.weight.shape
        new_emb.weight[:old_num, :old_dim] = old.weight
    return new_emb


def _grow_rmsnorm_weight(old_weight: torch.Tensor, new_dim: int) -> nn.Parameter:
    # RMSNorm's own __init__ starts every entry at 1.0 (see model.py),
    # not 0.0 or a random draw — matching that here, rather than reusing
    # the Linear/Embedding init scheme, is what keeps a widened norm
    # layer's new dimensions numerically sane from the first forward
    # pass instead of arbitrarily rescaling the whole normalized vector.
    new_weight = torch.ones(new_dim)
    new_weight[: old_weight.shape[0]] = old_weight
    return nn.Parameter(new_weight)


def grow_model(old_model: ShamSmall, new_cfg: ShamSmallConfig) -> ShamSmall:
    """Builds a fresh ShamSmall at new_cfg and copies every weight
    old_model has learned into it (see the module docstring above for
    exactly what is and isn't exactly preserved). new_cfg must be
    >= old_model.cfg in every one of vocab_size/d_model/n_layers/
    mlp_hidden/n_heads/n_kv_heads — this function only grows, it does
    not know how to shrink a model without losing information, so
    shrinking isn't offered as a silently-lossy option here."""
    old_cfg = old_model.cfg
    for field in ("vocab_size", "d_model", "n_layers", "mlp_hidden", "n_heads", "n_kv_heads"):
        if getattr(new_cfg, field) < getattr(old_cfg, field):
            raise ValueError(
                f"new_cfg.{field}={getattr(new_cfg, field)} is smaller than "
                f"old_model.cfg.{field}={getattr(old_cfg, field)} — grow_model only grows"
            )

    new_model = ShamSmall(new_cfg)

    with torch.no_grad():
        if not (old_cfg.tie_embeddings and new_cfg.tie_embeddings):
            # Untied embeddings would need lm_head grown as its own
            # separate weight, independent of token_embedding — not
            # implemented since the owner's actual config always ties
            # them (see ShamSmallConfig/build_default_model in
            # model.py), so this path has no real config to be tested
            # against; failing loudly here beats pretending it works.
            raise NotImplementedError(
                "grow_model only supports tie_embeddings=True on both the old and new config"
            )
        new_model.token_embedding = _grow_embedding(old_model.token_embedding, new_cfg.vocab_size, new_cfg.d_model)
        new_model.lm_head.weight = new_model.token_embedding.weight

        new_model.final_norm.weight = _grow_rmsnorm_weight(old_model.final_norm.weight, new_cfg.d_model)

        for i in range(new_cfg.n_layers):
            new_layer = new_model.layers[i]
            if i < old_cfg.n_layers:
                old_layer = old_model.layers[i]
                new_layer.input_norm.weight = _grow_rmsnorm_weight(old_layer.input_norm.weight, new_cfg.d_model)
                new_layer.post_attention_norm.weight = _grow_rmsnorm_weight(
                    old_layer.post_attention_norm.weight, new_cfg.d_model
                )

                new_head_dim = new_cfg.d_model // new_cfg.n_heads
                new_layer.attention.q_proj = _grow_linear(
                    old_layer.attention.q_proj, new_cfg.n_heads * new_head_dim, new_cfg.d_model
                )
                new_layer.attention.k_proj = _grow_linear(
                    old_layer.attention.k_proj, new_cfg.n_kv_heads * new_head_dim, new_cfg.d_model
                )
                new_layer.attention.v_proj = _grow_linear(
                    old_layer.attention.v_proj, new_cfg.n_kv_heads * new_head_dim, new_cfg.d_model
                )
                new_layer.attention.o_proj = _grow_linear(
                    old_layer.attention.o_proj, new_cfg.d_model, new_cfg.n_heads * new_head_dim
                )
                new_layer.attention.head_dim = new_head_dim
                new_layer.attention.n_heads = new_cfg.n_heads
                new_layer.attention.n_kv_heads = new_cfg.n_kv_heads
                new_layer.attention.n_rep = new_cfg.n_heads // new_cfg.n_kv_heads

                new_layer.mlp.gate_proj = _grow_linear(old_layer.mlp.gate_proj, new_cfg.mlp_hidden, new_cfg.d_model)
                new_layer.mlp.up_proj = _grow_linear(old_layer.mlp.up_proj, new_cfg.mlp_hidden, new_cfg.d_model)
                new_layer.mlp.down_proj = _grow_linear(old_layer.mlp.down_proj, new_cfg.d_model, new_cfg.mlp_hidden)
            else:
                # A brand new layer beyond the old model's depth: zero
                # out its two output-facing projections so it starts as
                # an identity map on the residual stream (see the module
                # docstring's guarantee #1) — real new capacity that
                # training will grow into, without corrupting what the
                # earlier, already-trained layers currently compute.
                nn.init.zeros_(new_layer.attention.o_proj.weight)
                nn.init.zeros_(new_layer.mlp.down_proj.weight)

    return new_model


if __name__ == "__main__":
    torch.manual_seed(0)

    # --- 1. Depth-only growth: must be an EXACT function match --------
    base_cfg = ShamSmallConfig(vocab_size=128, d_model=32, n_layers=2, n_heads=4, n_kv_heads=2, mlp_hidden=64, max_seq_len=32)
    base_model = ShamSmall(base_cfg)
    base_model.eval()

    deeper_cfg = replace(base_cfg, n_layers=5)
    deeper_model = grow_model(base_model, deeper_cfg)
    deeper_model.eval()

    dummy_input = torch.randint(0, base_cfg.vocab_size, (2, 6))
    with torch.no_grad():
        base_logits, _ = base_model(dummy_input)
        deeper_logits, _ = deeper_model(dummy_input)
    max_diff = (base_logits - deeper_logits).abs().max().item()
    assert torch.allclose(base_logits, deeper_logits, atol=1e-5), (
        f"depth-only growth should be exactly function-preserving but diverged by {max_diff:.2e}"
    )
    print(f"depth-only growth OK: 2 layers -> 5 layers produces IDENTICAL output (max diff {max_diff:.2e}) "
          f"— the new layers really do start as no-ops.")

    # --- 2. Vocab-only growth: exact logit match for every old token --
    wider_vocab_cfg = replace(base_cfg, vocab_size=256)
    wider_vocab_model = grow_model(base_model, wider_vocab_cfg)
    wider_vocab_model.eval()
    with torch.no_grad():
        base_logits2, _ = base_model(dummy_input)
        wider_logits2, _ = wider_vocab_model(dummy_input)
    old_vocab_logits = wider_logits2[:, :, : base_cfg.vocab_size]
    max_diff2 = (base_logits2 - old_vocab_logits).abs().max().item()
    assert torch.allclose(base_logits2, old_vocab_logits, atol=1e-5), (
        f"vocab-only growth should exactly preserve every old token's logits but diverged by {max_diff2:.2e}"
    )
    print(f"vocab-only growth OK: 128 -> 256 vocab entries, every OLD token's logits unchanged "
          f"(max diff {max_diff2:.2e}); the 128 new token classes are freshly initialized, as expected.")

    # --- 3. Width growth: structural weight preservation + finite output
    wider_cfg = replace(base_cfg, d_model=64, mlp_hidden=128, n_heads=8, n_kv_heads=4)
    wider_model = grow_model(base_model, wider_cfg)
    with torch.no_grad():
        old_q = base_model.layers[0].attention.q_proj.weight
        new_q = wider_model.layers[0].attention.q_proj.weight
        assert torch.equal(new_q[: old_q.shape[0], : old_q.shape[1]], old_q), (
            "width growth did not exactly preserve the old q_proj weight submatrix"
        )
        wide_logits, wide_loss = wider_model(dummy_input, labels=dummy_input)
    assert wide_logits.shape == (2, 6, base_cfg.vocab_size)
    assert torch.isfinite(wide_loss)
    print(f"width growth OK: d_model 32->64 (and mlp_hidden/n_heads grown to match) preserves every old "
          f"weight exactly in its submatrix, and the grown model runs a real, finite forward pass "
          f"(loss={wide_loss.item():.4f}) — a warm start for further training, not exact function "
          f"preservation, as documented above.")

    # --- 4. Growing everything at once, including depth, still works --
    full_cfg = ShamSmallConfig(
        vocab_size=256, d_model=64, n_layers=5, n_heads=8, n_kv_heads=4, mlp_hidden=128, max_seq_len=32
    )
    full_model = grow_model(base_model, full_cfg)
    with torch.no_grad():
        full_logits, full_loss = full_model(dummy_input, labels=dummy_input)
    assert full_logits.shape == (2, 6, 256)
    assert torch.isfinite(full_loss)
    print(f"combined growth OK: vocab+width+depth grown together in one call, real finite forward pass "
          f"(loss={full_loss.item():.4f}).")

    print("\nAll expansion checks passed — a trained ShamSmall checkpoint can genuinely grow into a "
          "larger config without discarding its learned weights.")
