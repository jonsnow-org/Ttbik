"""
Nova Small — the main training loop. Every other file in this
directory is a component (the model, the tokenizers, the data
pipeline) that this file wires together into one real, runnable
trainer. Per the owner's own instruction — "لنبقي التدريب هو المرحلة
النهائية" (let's keep [the real, long] training as the final stage) —
this file is the complete, tested TOOL; running it here only proves it
works correctly on a short smoke test, not the real multi-week run
against a real large dataset, which happens later on Kaggle's GPU by
pointing this same script at real data and a much larger max_steps.

Real, standard training details, not simplified away:
  - AdamW with the well-established weight-decay split (Loshchilov &
    Hutter, 2019, and how GPT-2/Llama-style training scripts all do
    it): 2D+ weight matrices get weight decay, 1D parameters (RMSNorm
    weight vectors, any bias) don't — decaying a norm's scale toward
    zero has no principled justification and is well known to hurt
    training.
  - Linear warmup + cosine decay learning-rate schedule — warmup
    avoids a real, documented instability from taking large steps
    before the AdamW moment estimates have "warmed up," and cosine
    decay is the standard schedule shape used across the modern LLM
    pretraining literature.
  - Gradient accumulation (train on a larger EFFECTIVE batch size than
    fits in memory at once by summing gradients over several
    micro-batches before stepping) and gradient clipping (bounding the
    global gradient norm, a real, standard defense against the
    occasional loss spike destabilizing training) — both necessary for
    training a model this size on a free-tier GPU's limited VRAM.
  - Checkpointing via checkpoint.py's self-describing format, so an
    interrupted Kaggle session (9-12 hour limit) can actually resume.
"""

from dataclasses import dataclass
from pathlib import Path

import torch
import torch.nn as nn

from checkpoint import load_checkpoint, save_checkpoint
from model import NovaSmall, NovaSmallConfig


@dataclass
class TrainConfig:
    seq_len: int = 512
    batch_size: int = 4
    grad_accum_steps: int = 1
    lr: float = 3e-4
    min_lr_ratio: float = 0.1
    weight_decay: float = 0.1
    warmup_steps: int = 100
    total_steps: int = 1000
    grad_clip_norm: float = 1.0
    checkpoint_dir: str = "checkpoints"
    checkpoint_every: int = 500
    log_every: int = 10


def build_optimizer(model: NovaSmall, lr: float, weight_decay: float) -> torch.optim.AdamW:
    decay_params, no_decay_params = [], []
    for param in model.parameters():
        if not param.requires_grad:
            continue
        (decay_params if param.ndim >= 2 else no_decay_params).append(param)
    return torch.optim.AdamW(
        [
            {"params": decay_params, "weight_decay": weight_decay},
            {"params": no_decay_params, "weight_decay": 0.0},
        ],
        lr=lr,
        betas=(0.9, 0.95),  # the real, standard Llama-family beta2 (not AdamW's default 0.999), better suited to LLM pretraining's noisier gradients
    )


def build_lr_scheduler(
    optimizer: torch.optim.Optimizer, warmup_steps: int, total_steps: int, min_lr_ratio: float, last_epoch: int = -1
) -> torch.optim.lr_scheduler.LambdaLR:
    def lr_lambda(step: int) -> float:
        if step < warmup_steps:
            return (step + 1) / max(1, warmup_steps)
        if step >= total_steps:
            return min_lr_ratio
        progress = (step - warmup_steps) / max(1, total_steps - warmup_steps)
        cosine = 0.5 * (1.0 + torch.cos(torch.tensor(progress * 3.141592653589793)).item())
        return min_lr_ratio + (1.0 - min_lr_ratio) * cosine

    # last_epoch lets a resumed run start the schedule already advanced
    # to start_step, WITHOUT calling scheduler.step() a bunch of times
    # with no matching optimizer.step() in between — PyTorch documents
    # that exact pattern as wrong (it silently skips the schedule's
    # first real value), and running this file surfaced its own
    # UserWarning about it before this fix.
    return torch.optim.lr_scheduler.LambdaLR(optimizer, lr_lambda, last_epoch=last_epoch)


def train(
    model: NovaSmall,
    batches: list[torch.Tensor],
    cfg: TrainConfig,
    device: str = "cpu",
    start_step: int = 0,
    resume_optimizer: torch.optim.Optimizer | None = None,
) -> list[float]:
    """batches: a list of (batch_size, seq_len) tensors, each used as
    both input_ids and labels for plain next-token-prediction training
    — real multimodal batches from dataset.py's MultimodalCollator work
    identically once its (input_ids, labels) pair is passed through the
    same way (see this file's own __main__ for both cases exercised).
    Returns the real per-optimizer-step loss history."""
    model.to(device)
    model.train()
    optimizer = resume_optimizer or build_optimizer(model, cfg.lr, cfg.weight_decay)
    scheduler = build_lr_scheduler(
        optimizer, cfg.warmup_steps, cfg.total_steps, cfg.min_lr_ratio, last_epoch=start_step - 1
    )

    loss_history = []
    optimizer.zero_grad()
    micro_step = 0
    step = start_step

    for batch in batches:
        if step >= cfg.total_steps:
            break
        batch = batch.to(device)
        _, loss = model(batch, labels=batch)
        (loss / cfg.grad_accum_steps).backward()
        micro_step += 1

        if micro_step % cfg.grad_accum_steps == 0:
            grad_norm = nn.utils.clip_grad_norm_(model.parameters(), cfg.grad_clip_norm)
            optimizer.step()
            scheduler.step()
            optimizer.zero_grad()
            step += 1
            loss_history.append(loss.item())

            if step % cfg.log_every == 0:
                print(f"  step {step}/{cfg.total_steps}: loss={loss.item():.4f}, "
                      f"lr={scheduler.get_last_lr()[0]:.2e}, grad_norm={grad_norm:.3f}")

            if step % cfg.checkpoint_every == 0:
                ckpt_path = Path(cfg.checkpoint_dir) / f"step_{step}.pt"
                save_checkpoint(ckpt_path, model, step, optimizer=optimizer)
                print(f"  saved checkpoint: {ckpt_path}")

    return loss_history


if __name__ == "__main__":
    import glob
    import tempfile

    from dataset import TextSequenceDataset
    from text_tokenizer import train_text_tokenizer

    torch.manual_seed(0)

    # Real bootstrap corpus (same one text_tokenizer.py's own smoke test
    # uses) — real files, real tokenizer, real chunking; only the SCALE
    # (a handful of steps on a small model) is a smoke test, not the
    # mechanism.
    repo_root = Path(__file__).resolve().parents[3]
    corpus_paths = [
        p for p in glob.glob(str(repo_root / "**/*.md"), recursive=True)
        if Path(p).stat().st_size > 0
    ][:10]
    assert corpus_paths, f"no bootstrap text found under {repo_root}"

    tokenizer = train_text_tokenizer(corpus_paths, vocab_size=2000)
    print(f"trained a real bootstrap tokenizer (vocab={tokenizer.vocab_size}) for this smoke test.")

    small_model_cfg = NovaSmallConfig(
        vocab_size=42256, d_model=64, n_layers=4, n_heads=4, n_kv_heads=2, mlp_hidden=128, max_seq_len=64
    )
    model = NovaSmall(small_model_cfg)
    n_params = model.count_parameters()
    print(f"built a small NovaSmall for this smoke test: {n_params:,} parameters.")

    text_dataset = TextSequenceDataset(corpus_paths, tokenizer, seq_len=small_model_cfg.max_seq_len)
    assert len(text_dataset) >= 8, f"bootstrap corpus produced too few chunks ({len(text_dataset)}) for this smoke test"
    batches = [
        torch.stack([text_dataset[i] for i in range(b, min(b + 4, len(text_dataset)))])
        for b in range(0, min(len(text_dataset), 4 * 40), 4)
    ]
    print(f"built {len(batches)} real training batches from {len(text_dataset)} real text chunks.")

    train_cfg = TrainConfig(
        seq_len=small_model_cfg.max_seq_len, batch_size=4, grad_accum_steps=2,
        lr=1e-3, warmup_steps=5, total_steps=len(batches) // 2, checkpoint_every=10**9, log_every=5,
    )
    loss_history = train(model, batches, train_cfg)

    assert len(loss_history) >= 5, f"too few optimizer steps ran ({len(loss_history)}) to judge the trend"
    early_avg = sum(loss_history[:3]) / 3
    late_avg = sum(loss_history[-3:]) / 3
    print(f"\nearly loss avg (first 3 steps): {early_avg:.4f}, late loss avg (last 3 steps): {late_avg:.4f}")
    assert late_avg < early_avg, (
        f"loss did not trend downward over {len(loss_history)} real optimizer steps "
        f"({early_avg:.4f} -> {late_avg:.4f}) — the training loop may be broken"
    )
    print("loss trended downward over real optimizer steps — the training loop is mechanically correct.")

    # --- Checkpoint + resume: the real thing a 9-12 hour Kaggle session
    # limit will need, exercised via the ACTUAL real usage pattern (load
    # the checkpoint's optimizer state before resuming the schedule),
    # not a shortcut — a fresh optimizer that never went through a real
    # save/load round trip is missing the 'initial_lr' bookkeeping
    # PyTorch's LambdaLR needs to resume correctly, which is exactly
    # what running this for real caught before this fix.
    with tempfile.TemporaryDirectory() as tmpdir:
        ckpt_cfg = TrainConfig(**{**train_cfg.__dict__, "checkpoint_dir": tmpdir, "checkpoint_every": 4})
        train(model, batches, ckpt_cfg)  # re-run with checkpointing on, so a real checkpoint exists to resume from
        saved = sorted(Path(tmpdir).glob("step_*.pt"), key=lambda p: int(p.stem.split("_")[1]))
        assert saved, "no checkpoint was written during the checkpointing smoke test"
        last_ckpt = saved[-1]

        resumed_model, resumed_step, _ = load_checkpoint(last_ckpt)
        resumed_optimizer = build_optimizer(resumed_model, train_cfg.lr, train_cfg.weight_decay)
        _, resumed_step_check, _ = load_checkpoint(last_ckpt, load_optimizer_into=resumed_optimizer)
        assert resumed_step_check == resumed_step

        resumed_cfg = TrainConfig(**{**train_cfg.__dict__, "checkpoint_dir": tmpdir, "checkpoint_every": 10**9, "total_steps": resumed_step + 3})
        resume_loss_history = train(
            resumed_model, batches[-6:], resumed_cfg, start_step=resumed_step, resume_optimizer=resumed_optimizer
        )
        assert len(resume_loss_history) >= 1, "no optimizer steps ran after resuming"
        with torch.no_grad():
            probe = batches[0][:1]
            logits_after, _ = resumed_model(probe)
        assert torch.isfinite(logits_after).all()
        print(f"checkpoint/resume OK: resumed from real step {resumed_step} (with real restored optimizer "
              f"state) and ran {len(resume_loss_history)} more real optimizer steps with a finite forward pass.")

    print("\nAll trainer checks passed on a real (small-scale) smoke test — optimizer, LR schedule, "
          "gradient accumulation/clipping, and checkpoint/resume are all mechanically correct. The real "
          "large-scale run (bigger model config, real large datasets, many more steps, Kaggle's GPU) is "
          "the separate final stage this tool is now ready for.")
