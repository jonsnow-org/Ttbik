"""
Sham Small — Maximal Update Parameterization (μP; Yang & Hu, 2022,
"Tensor Programs V") scaling utilities.

The real problem this solves: the owner's own stated target is scaling
this architecture from the current ~500M config toward 7B+ ("قابل مع
التدريب والتطوير للوصول لاكثر من 7B"). Under STANDARD parameterization
(what model.py's plain std=0.02 init and a single flat learning rate for
every parameter already do), the learning rate that works well at one
width is NOT the one that works well at a much wider one — doubling
d_model measurably shifts the optimal LR, so every new scale needs its
own expensive from-scratch hyperparameter search. μP instead defines
specific per-layer-type multipliers on init variance and learning rate,
derived so that a model's INTERNAL ACTIVATION STATISTICS stay stable
across widths -- which is the theoretical guarantee behind the practice
of "μP transfer": tune the learning rate cheaply on a small PROXY width,
then reuse that exact same number at the real, expensive target width,
with no separate search needed there.

The real per-layer-type rule this file implements (the "abc-parameterization"
table, specialized here for Adam/AdamW, which is what train.py/
train_from_stream.py already use everywhere):

  layer type              | init std multiplier | LR multiplier
  -------------------------|----------------------|----------------
  input embedding           | 1 (unchanged)        | 1 (unchanged)
  hidden weights            | 1/sqrt(m)            | 1/m
  (attention/MLP projections)
  output/readout projection | 1/m (on top of 1/sqrt(m) base -> 1/m total std multiplier vs base) | 1/m

  where m = d_model / d_model_base is the width ratio against whatever
  small width the hyperparameters were actually tuned on.

TIED EMBEDDINGS, addressed directly (this is the real subtlety a naive
μP port would get wrong): ShamSmall ties the input embedding and the
output (lm_head) weight -- one shared matrix, used in two directions
(model.py's own ShamSmallConfig.tie_embeddings). μP's input-embedding
rule and its output-layer rule are DIFFERENT (unchanged vs. 1/m), which
is a real conflict when it is the SAME physical weight matrix serving
both roles at once. The standard, published resolution (used in
practice whenever weight tying meets μP): keep the shared matrix on the
INPUT rule (unchanged init/LR, since untying into two separate matrices
is a real architecture change out of scope here), and apply the
OUTPUT rule's width-dependent scaling as a separate multiplier on the
LOGITS themselves, after the shared matrix has already been used --
mathematically equivalent to scaling only the output "copy" of the
matrix, without needing two physical matrices. This is exactly why
model.py's ShamSmallConfig now has an `output_mult` field applied to the
final logits (see that file's own comment) rather than this file trying
to rescale the tied weight in place.
"""

from __future__ import annotations

from dataclasses import dataclass

import torch
import torch.nn as nn

from model import Attention, ShamSmall, ShamSmallConfig, SwiGLU


@dataclass
class MuPPlan:
    """The real, concrete numbers to apply for a given (base_width,
    target_width) pair -- computed once, then used both to build the
    target-width model's config (output_mult) and to build its
    optimizer (per-parameter-group LR multipliers)."""

    width_mult: float
    hidden_init_std_mult: float
    hidden_lr_mult: float
    output_mult: float
    output_lr_mult: float


def compute_mup_plan(d_model_base: int, d_model_target: int) -> MuPPlan:
    if d_model_base <= 0 or d_model_target <= 0:
        raise ValueError("widths must be positive")
    m = d_model_target / d_model_base
    return MuPPlan(
        width_mult=m,
        hidden_init_std_mult=1.0 / (m**0.5),
        hidden_lr_mult=1.0 / m,
        output_mult=1.0 / m,
        output_lr_mult=1.0 / m,
    )


def apply_mup_init(model: ShamSmall, plan: MuPPlan, base_init_std: float = 0.02) -> None:
    """Re-initializes every HIDDEN weight (attention q/k/v/o projections,
    SwiGLU gate/up/down projections) at base_init_std * hidden_init_std_mult
    instead of model.py's default flat base_init_std everywhere. Deliberately
    leaves the token embedding (and, since tie_embeddings=True, the tied
    lm_head weight it shares) untouched -- the input-embedding μP rule is
    "unchanged," and this project's tied-embedding case additionally
    handles the OUTPUT side via cfg.output_mult, not by touching this
    shared weight's own init/scale."""
    target_std = base_init_std * plan.hidden_init_std_mult
    for module in model.modules():
        if isinstance(module, (Attention, SwiGLU)):
            for submodule in module.modules():
                if isinstance(submodule, nn.Linear):
                    nn.init.normal_(submodule.weight, mean=0.0, std=target_std)


def mup_param_groups(model: ShamSmall, plan: MuPPlan, base_lr: float) -> list[dict]:
    """Splits the model's parameters into three real optimizer param
    groups with different learning rates -- everything hinges on getting
    this partition right, since a parameter silently left in the wrong
    group defeats the whole transfer guarantee:
      - token_embedding (and the tied lm_head, since it's the SAME
        tensor object when tie_embeddings=True): base_lr, unscaled.
      - final_norm / RMSNorm weights everywhere: base_lr, unscaled (μP
        does not rescale norm gains, which have no width-dependent
        fan-in the way a Linear layer's weight does).
      - every hidden Linear inside Attention/SwiGLU: base_lr * hidden_lr_mult.
    Every model parameter must land in exactly one group -- verified
    directly in this file's own __main__, not assumed."""
    embedding_ids = {id(p) for p in model.token_embedding.parameters()}
    hidden_ids: set[int] = set()
    for module in model.modules():
        if isinstance(module, (Attention, SwiGLU)):
            for submodule in module.modules():
                if isinstance(submodule, nn.Linear):
                    hidden_ids.update(id(p) for p in submodule.parameters())

    embedding_params, hidden_params, other_params = [], [], []
    for p in model.parameters():
        if id(p) in embedding_ids:
            embedding_params.append(p)
        elif id(p) in hidden_ids:
            hidden_params.append(p)
        else:
            other_params.append(p)

    return [
        {"params": embedding_params, "lr": base_lr, "name": "embedding_and_tied_output"},
        {"params": hidden_params, "lr": base_lr * plan.hidden_lr_mult, "name": "hidden_weights"},
        {"params": other_params, "lr": base_lr, "name": "norms_and_other"},
    ]


def build_mup_model(cfg: ShamSmallConfig, plan: MuPPlan, base_init_std: float = 0.02) -> ShamSmall:
    """Builds a model at cfg's own (target) width with μP init and the
    output logit multiplier both applied -- the one function real
    training code should call instead of ShamSmall(cfg) directly when
    doing a μP-transferred run."""
    cfg.output_mult = plan.output_mult
    model = ShamSmall(cfg)
    apply_mup_init(model, plan, base_init_std=base_init_std)
    return model


if __name__ == "__main__":
    import torch.optim as optim

    torch.manual_seed(0)

    # --- 1) Every parameter lands in exactly one optimizer group.
    plan = compute_mup_plan(d_model_base=64, d_model_target=256)
    cfg = ShamSmallConfig(vocab_size=1000, d_model=256, n_layers=3, n_heads=4, n_kv_heads=2, mlp_hidden=512, max_seq_len=32)
    model = build_mup_model(cfg, plan)
    groups = mup_param_groups(model, plan, base_lr=1e-3)
    total_in_groups = sum(len(g["params"]) for g in groups)
    total_in_model = len(list(model.parameters()))
    assert total_in_groups == total_in_model, (
        f"parameter partition is incomplete/overlapping: {total_in_groups} params across groups, "
        f"{total_in_model} real params on the model"
    )
    print(f"parameter partition OK: all {total_in_model} real parameters land in exactly one of "
          f"{len(groups)} groups ({[g['name'] for g in groups]}).")

    hidden_group = next(g for g in groups if g["name"] == "hidden_weights")
    embed_group = next(g for g in groups if g["name"] == "embedding_and_tied_output")
    assert hidden_group["lr"] < embed_group["lr"], "hidden weights must get a SMALLER LR than the embedding at width > base"
    print(f"LR scaling OK: embedding/output lr={embed_group['lr']:.2e}, hidden lr={hidden_group['lr']:.2e} "
          f"(width_mult={plan.width_mult:.2f}).")

    # --- 2) The real coordinate check: train several widths with
    # μP-transferred hyperparameters and confirm a real internal
    # activation statistic (mean absolute value entering the final norm)
    # stays roughly STABLE across widths -- the actual, standard way μP
    # correctness is verified in the literature, not just asserted.
    # Compare against the SAME widths under NAIVE parameterization
    # (flat init/LR, no μP) to show the difference is real, not
    # coincidental to this particular model/data.
    base_width = 32
    widths_to_test = [32, 64, 128]
    base_lr = 3e-3
    seq_len = 16
    steps = 60

    def run_and_measure(width: int, use_mup: bool) -> float:
        torch.manual_seed(1)
        local_cfg = ShamSmallConfig(
            vocab_size=200, d_model=width, n_layers=2,
            n_heads=4, n_kv_heads=2, mlp_hidden=width * 2, max_seq_len=seq_len,
        )
        if use_mup:
            local_plan = compute_mup_plan(d_model_base=base_width, d_model_target=width)
            m = build_mup_model(local_cfg, local_plan)
            optimizer = optim.AdamW(mup_param_groups(m, local_plan, base_lr=base_lr))
        else:
            m = ShamSmall(local_cfg)
            optimizer = optim.AdamW(m.parameters(), lr=base_lr)

        m.train()
        data = torch.randint(0, local_cfg.vocab_size, (4, seq_len))
        for _ in range(steps):
            optimizer.zero_grad()
            _, loss = m(data, labels=data)
            loss.backward()
            optimizer.step()

        # Real activation statistic: mean absolute value of the residual
        # stream right before the final norm, on a fresh forward pass --
        # this is exactly the quantity μP's own coordinate check plots
        # against width.
        with torch.no_grad():
            x = m.token_embedding(data)
            cos = m.rope_cos.to(x.device)
            sin = m.rope_sin.to(x.device)
            for layer in m.layers:
                x, _ = layer(x, cos, sin)
            return x.abs().mean().item()

    mup_stats = {w: run_and_measure(w, use_mup=True) for w in widths_to_test}
    naive_stats = {w: run_and_measure(w, use_mup=False) for w in widths_to_test}

    print(f"\nactivation scale (mean |activation| before final norm) vs width:")
    print(f"  with muP:    {mup_stats}")
    print(f"  without muP: {naive_stats}")

    def relative_spread(stats: dict[int, float]) -> float:
        values = list(stats.values())
        return (max(values) - min(values)) / (sum(values) / len(values))

    mup_spread = relative_spread(mup_stats)
    naive_spread = relative_spread(naive_stats)
    print(f"\nrelative spread across widths: muP={mup_spread:.2f}, naive={naive_spread:.2f}")
    assert mup_spread < naive_spread, (
        f"muP should keep activation scale MORE stable across widths than naive parameterization, "
        f"got muP spread={mup_spread:.2f} vs naive spread={naive_spread:.2f}"
    )
    print("\nconfirmed: with the SAME base learning rate transferred to every width, muP-scaled "
          "init/LR keeps real internal activation scale far more stable across widths than naive "
          "flat parameterization -- the real coordinate-check evidence behind why a learning rate "
          "tuned cheaply at a small width should transfer to the real, expensive target width.")
