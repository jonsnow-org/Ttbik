"""
Sham — the main training loop. Every other file in this
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

import time
from dataclasses import dataclass
from pathlib import Path

import torch
import torch.nn as nn

from checkpoint import load_checkpoint, save_checkpoint
from model import ShamSmall, ShamSmallConfig


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
    # A real, directly-hit failure this defends against: a ~108M-param
    # model's checkpoint (weights + AdamW's two moment buffers, roughly
    # 4x the raw parameter count) is over 1GB on its own — a long real
    # run checkpointing every few hundred steps accumulates ONE NEW FILE
    # per checkpoint forever, and a multi-hour Kaggle run blew straight
    # through Kaggle's ~20GB /kaggle/working quota this way ("Your
    # notebook tried to use more disk space than is available", real
    # incident, 2026-09-14) — with the notebook's own final save/render
    # step then failing too, since there was no disk left to write it.
    # Keeping only the N most recent checkpoints bounds disk use to a
    # small constant regardless of how long the run goes.
    keep_last_n_checkpoints: int = 2
    # Real, additive speed/memory optimizations for the actual Kaggle GPU
    # run (default OFF so every existing CPU smoke test above is
    # completely unaffected): mixed_precision picks bf16 when the GPU
    # supports it in hardware (rare on Kaggle's usual T4/P100 -- both are
    # pre-Ampere and only emulate bf16 in software) and falls back to
    # fp16 + GradScaler otherwise, which IS properly tensor-core
    # accelerated on a T4. FlashAttention-2 itself needs no separate flag
    # here: model.py already calls F.scaled_dot_product_attention, which
    # PyTorch dispatches to a real fused Flash/memory-efficient kernel on
    # CUDA automatically -- hand-rolling the standalone flash-attn
    # package would be a redundant, harder-to-install duplicate of what
    # SDPA already does.
    mixed_precision: bool = False
    compile_model: bool = False

    # A real second incident this defends against: picking total_steps
    # from a short speed calibration (e.g. 20 steps) and trusting it for
    # the WHOLE run is a real, hit failure mode — real throughput can run
    # slower over hours than a brief early sample suggested, and a
    # Kaggle "Save & Run All" job that runs past its real hard limit
    # gets SIGKILLed (exit code 137) with NO chance to save a final
    # checkpoint or let later notebook cells run at all (real incident,
    # 2026-09-15: a run was killed at exactly 43201s, Kaggle's own
    # observed 12-hour ceiling for this environment). None (default)
    # disables this — set it to a real number of seconds, with margin
    # below whatever hard limit applies, and train() checks real elapsed
    # wall-clock time (not just step count) and stops itself gracefully,
    # so whatever ran so far is saved and the notebook's own later cells
    # (final save, printouts) still get to run normally instead of being
    # killed mid-flight.
    max_wall_clock_seconds: float | None = None


def build_optimizer(model: ShamSmall, lr: float, weight_decay: float) -> torch.optim.AdamW:
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
    #
    # A real second bug this also fixes: PyTorch's LambdaLR only sets
    # each param group's 'initial_lr' automatically when constructed
    # with last_epoch=-1 — a genuinely fresh optimizer combined with a
    # nonzero last_epoch (e.g. continuing training on pretrained
    # weights with a brand-new optimizer, not one loaded from a real
    # saved optimizer_state_dict — see kaggle_notebooks' multimodal
    # stage for exactly this case) raises a real KeyError on
    # 'initial_lr' otherwise. Setting it explicitly here beforehand
    # matches what LambdaLR does internally for a fresh construction,
    # so a nonzero last_epoch works regardless of whether the optimizer
    # was actually resumed or is fresh.
    if last_epoch != -1:
        for group in optimizer.param_groups:
            group.setdefault("initial_lr", group["lr"])

    return torch.optim.lr_scheduler.LambdaLR(optimizer, lr_lambda, last_epoch=last_epoch)


def train(
    model: ShamSmall,
    batches: list[torch.Tensor | tuple[torch.Tensor, torch.Tensor]],
    cfg: TrainConfig,
    device: str = "cpu",
    start_step: int = 0,
    resume_optimizer: torch.optim.Optimizer | None = None,
) -> list[float]:
    """batches: a list where each element is EITHER a plain
    (batch_size, seq_len) tensor (used as both input_ids and labels —
    the TextSequenceDataset case, no padding involved) OR a real
    (input_ids, labels) tuple as produced by dataset.py's
    MultimodalCollator/AudioMultimodalCollator, where labels carries
    -100 on PAD positions so padded batch elements contribute no loss
    (model.py's forward() already passes ignore_index=-100 to
    cross_entropy for exactly this). Mixing both kinds of elements in
    one `batches` list is exactly how a real combined text+image+audio
    training run continues a checkpoint — see kaggle_notebooks'
    multimodal stage for a real example. Returns the real
    per-optimizer-step loss history."""
    model.to(device)
    model.train()
    optimizer = resume_optimizer or build_optimizer(model, cfg.lr, cfg.weight_decay)
    scheduler = build_lr_scheduler(
        optimizer, cfg.warmup_steps, cfg.total_steps, cfg.min_lr_ratio, last_epoch=start_step - 1
    )

    # raw_model (never compiled) is what gets checkpointed -- keeps
    # checkpoint.py's saved state_dict format stable regardless of
    # whether torch.compile's wrapper is involved in the forward pass.
    raw_model = model
    if cfg.compile_model and device.startswith("cuda"):
        model = torch.compile(model)

    use_amp = cfg.mixed_precision and device.startswith("cuda")
    amp_dtype = torch.bfloat16 if (use_amp and torch.cuda.is_bf16_supported()) else torch.float16
    use_scaler = use_amp and amp_dtype == torch.float16
    scaler = torch.amp.GradScaler("cuda", enabled=use_scaler)

    loss_history = []
    optimizer.zero_grad()
    micro_step = 0
    step = start_step
    start_time = time.time()
    stopped_early_for_time = False

    for batch in batches:
        if step >= cfg.total_steps:
            break
        if cfg.max_wall_clock_seconds is not None and (time.time() - start_time) >= cfg.max_wall_clock_seconds:
            stopped_early_for_time = True
            break
        if isinstance(batch, tuple):
            input_ids, labels = batch
            input_ids, labels = input_ids.to(device), labels.to(device)
        else:
            input_ids = labels = batch.to(device)
        with torch.autocast(device_type="cuda", dtype=amp_dtype, enabled=use_amp):
            _, loss = model(input_ids, labels=labels)
        scaled_loss = loss / cfg.grad_accum_steps
        if use_scaler:
            scaler.scale(scaled_loss).backward()
        else:
            scaled_loss.backward()
        micro_step += 1

        if micro_step % cfg.grad_accum_steps == 0:
            if use_scaler:
                scaler.unscale_(optimizer)
            grad_norm = nn.utils.clip_grad_norm_(model.parameters(), cfg.grad_clip_norm)
            if use_scaler:
                scaler.step(optimizer)
                scaler.update()
            else:
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
                save_checkpoint(ckpt_path, raw_model, step, optimizer=optimizer)
                print(f"  saved checkpoint: {ckpt_path}")
                _prune_old_checkpoints(Path(cfg.checkpoint_dir), cfg.keep_last_n_checkpoints)

    if stopped_early_for_time:
        # A real, guaranteed-fresh checkpoint at the exact stopping point
        # — never rely on step % checkpoint_every having lined up with
        # the moment the time budget ran out, or real progress since the
        # last periodic save is silently lost.
        final_path = Path(cfg.checkpoint_dir) / f"step_{step}.pt"
        save_checkpoint(final_path, raw_model, step, optimizer=optimizer)
        _prune_old_checkpoints(Path(cfg.checkpoint_dir), cfg.keep_last_n_checkpoints)
        print(f"  stopped early at step {step}/{cfg.total_steps}: hit max_wall_clock_seconds="
              f"{cfg.max_wall_clock_seconds:.0f}s — saved {final_path} and returning normally so later "
              f"notebook cells still run (instead of Kaggle killing the whole session mid-flight).")

    return loss_history


def _prune_old_checkpoints(checkpoint_dir: Path, keep_last_n: int) -> None:
    """Deletes every step_*.pt checkpoint except the keep_last_n most
    recent ones (by step number) — the real, direct fix for a real
    incident: unbounded checkpoint accumulation over a long run exceeded
    Kaggle's disk quota and crashed the notebook (see TrainConfig's own
    docstring for the full incident). keep_last_n <= 0 disables pruning
    entirely (keeps everything), for callers that want every checkpoint
    on a machine with real disk to spare."""
    if keep_last_n <= 0:
        return
    checkpoints = sorted(
        checkpoint_dir.glob("step_*.pt"),
        key=lambda p: int(p.stem.split("_")[1]),
    )
    for stale in checkpoints[:-keep_last_n]:
        stale.unlink(missing_ok=True)


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

    small_model_cfg = ShamSmallConfig(
        vocab_size=42256, d_model=64, n_layers=4, n_heads=4, n_kv_heads=2, mlp_hidden=128, max_seq_len=64
    )
    model = ShamSmall(small_model_cfg)
    n_params = model.count_parameters()
    print(f"built a small ShamSmall for this smoke test: {n_params:,} parameters.")

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

    # --- Checkpoint pruning: the real fix for a real incident (a
    # multi-hour Kaggle run's unbounded checkpoint accumulation exceeded
    # Kaggle's disk quota and crashed the notebook). Checkpointing often
    # enough to produce many more than keep_last_n_checkpoints must leave
    # only that many real files on disk, always including the newest.
    with tempfile.TemporaryDirectory() as tmpdir:
        prune_cfg = TrainConfig(
            **{**train_cfg.__dict__, "checkpoint_dir": tmpdir, "checkpoint_every": 2, "keep_last_n_checkpoints": 2}
        )
        train(ShamSmall(small_model_cfg), batches, prune_cfg)
        remaining = sorted(Path(tmpdir).glob("step_*.pt"), key=lambda p: int(p.stem.split("_")[1]))
        assert len(remaining) == 2, f"expected exactly 2 checkpoints kept on disk, found {len(remaining)}: {remaining}"
        highest_step_saved = (prune_cfg.total_steps // prune_cfg.checkpoint_every) * prune_cfg.checkpoint_every
        assert int(remaining[-1].stem.split("_")[1]) == highest_step_saved, "the newest checkpoint must never be pruned"
        print(f"checkpoint pruning OK: {prune_cfg.total_steps // prune_cfg.checkpoint_every} real checkpoints were "
              f"saved over the run, but only the {len(remaining)} most recent remain on disk — exactly the fix for "
              f"the real 'notebook tried to use more disk space than is available' incident.")

    # --- max_wall_clock_seconds: the real fix for a real incident (a
    # Kaggle run hit the environment's actual 12-hour hard limit and was
    # SIGKILLed with no checkpoint saved at the cutoff and no chance for
    # later notebook cells to run at all). A real, tiny time budget here
    # must make train() stop itself well before exhausting `batches`,
    # save a real checkpoint at exactly that point, and return normally.
    with tempfile.TemporaryDirectory() as tmpdir:
        time_limited_cfg = TrainConfig(
            **{**train_cfg.__dict__, "checkpoint_dir": tmpdir, "checkpoint_every": 10**9, "max_wall_clock_seconds": 0.15}
        )
        time_limited_history = train(ShamSmall(small_model_cfg), batches, time_limited_cfg)
        assert 0 < len(time_limited_history) < len(batches), (
            f"expected an early, partial stop (some steps, not all {len(batches)}), got {len(time_limited_history)}"
        )
        time_limited_ckpts = list(Path(tmpdir).glob("step_*.pt"))
        assert time_limited_ckpts, "no checkpoint was saved when stopping early for max_wall_clock_seconds"
        _, saved_step, _ = load_checkpoint(time_limited_ckpts[0])
        assert saved_step == len(time_limited_history)
        print(f"max_wall_clock_seconds OK: stopped after {len(time_limited_history)}/{len(batches)} real steps "
              f"once the time budget ran out, with a real checkpoint saved at that exact step and train() "
              f"returning normally — this is what lets a Kaggle run save real progress and finish cleanly "
              f"instead of being killed mid-flight at the platform's own hard time limit.")

    # --- Real (input_ids, labels) tuple batches, the exact shape
    # dataset.py's MultimodalCollator/AudioMultimodalCollator produce
    # (padded, with -100 on PAD positions) — proves train() actually
    # handles the multimodal case, not just the plain-tensor text case
    # exercised above, and that -100-masked positions are genuinely
    # excluded from the loss rather than silently included.
    padded_len = small_model_cfg.max_seq_len
    tuple_batches = []
    for _ in range(8):
        real_len = torch.randint(4, padded_len, (1,)).item()
        ids = torch.randint(0, small_model_cfg.vocab_size, (2, real_len))
        pad = torch.zeros(2, padded_len - real_len, dtype=torch.long)
        input_ids = torch.cat([ids, pad], dim=1)
        labels = torch.cat([ids, torch.full((2, padded_len - real_len), -100, dtype=torch.long)], dim=1)
        tuple_batches.append((input_ids, labels))

    tuple_model = ShamSmall(small_model_cfg)
    tuple_cfg = TrainConfig(
        seq_len=padded_len, batch_size=2, grad_accum_steps=1, lr=1e-3, warmup_steps=2,
        total_steps=len(tuple_batches), checkpoint_every=10**9, log_every=10**9,
    )
    tuple_loss_history = train(tuple_model, tuple_batches, tuple_cfg)
    assert len(tuple_loss_history) == len(tuple_batches), "not every (input_ids, labels) tuple batch ran a real step"
    assert all(torch.isfinite(torch.tensor(l)) for l in tuple_loss_history), "a tuple-batch step produced a non-finite loss"
    print(f"\n(input_ids, labels) tuple-batch path OK: {len(tuple_loss_history)} real optimizer steps ran "
          f"on padded, -100-masked multimodal-shaped batches with finite loss throughout — this is the exact "
          f"path a real continued text+image+audio training run uses.")

    # --- Real bug this file's own history repeats, in a new shape: a
    # LOADED checkpoint (real nonzero step) continued with a BRAND-NEW
    # optimizer (not one loaded from a saved optimizer_state_dict) —
    # exactly the multimodal stage-2 case (weights carried over from
    # stage 1, but a fresh optimizer for the new image/audio objective).
    # Before this fix, build_lr_scheduler's last_epoch=start_step-1
    # raised a real KeyError on 'initial_lr' here.
    with tempfile.TemporaryDirectory() as tmpdir2:
        pretrained_model = ShamSmall(small_model_cfg)
        pretrained_ckpt = Path(tmpdir2) / "pretrained.pt"
        save_checkpoint(pretrained_ckpt, pretrained_model, step=500)
        loaded_model, loaded_step, _ = load_checkpoint(pretrained_ckpt)
        assert loaded_step == 500
        fresh_optimizer = build_optimizer(loaded_model, lr=1e-4, weight_decay=0.1)  # deliberately NOT loaded from a checkpoint
        continued_cfg = TrainConfig(
            seq_len=small_model_cfg.max_seq_len, batch_size=4, grad_accum_steps=1, lr=1e-4,
            warmup_steps=2, total_steps=loaded_step + 5, checkpoint_every=10**9, log_every=10**9,
        )
        continued_loss_history = train(
            loaded_model, batches[:5], continued_cfg, start_step=loaded_step, resume_optimizer=fresh_optimizer
        )
    assert len(continued_loss_history) == 5, "fresh-optimizer continued training from a loaded checkpoint didn't run"
    assert all(torch.isfinite(torch.tensor(l)) for l in continued_loss_history), "non-finite loss continuing with a fresh optimizer"
    print(f"fresh-optimizer continued-training OK: loaded a real checkpoint at step {loaded_step}, trained "
          f"{len(continued_loss_history)} more real steps with a BRAND-NEW optimizer (no KeyError on "
          f"'initial_lr') — this is exactly the multimodal stage-2 pattern.")

    print("\nAll trainer checks passed on a real (small-scale) smoke test — optimizer, LR schedule, "
          "gradient accumulation/clipping, checkpoint/resume, the multimodal (input_ids, labels) tuple "
          "path, and continuing a loaded checkpoint with a fresh optimizer are all mechanically correct. "
          "The real large-scale run (bigger model config, real large datasets, many more steps, Kaggle's "
          "GPU) is the separate final stage this tool is now ready for.")

    # --- mixed_precision/compile_model gating: this sandbox has no CUDA
    # (verified directly — torch.cuda.is_available() is False here), so
    # the real accelerated code paths can't be exercised end-to-end. What
    # IS checked for real: setting both flags to True on a CPU device
    # must not crash and must produce identical mechanical behavior to
    # leaving them off (device.startswith("cuda") gates both off) — a
    # realistic case if a notebook cell sets these flags without first
    # checking what device it actually got.
    amp_cfg = TrainConfig(**{**train_cfg.__dict__, "mixed_precision": True, "compile_model": True})
    amp_loss_history = train(ShamSmall(small_model_cfg), batches, amp_cfg, device="cpu")
    assert len(amp_loss_history) == len(loss_history), "mixed_precision/compile_model flags changed step count on CPU"
    assert all(torch.isfinite(torch.tensor(l)) for l in amp_loss_history), "non-finite loss with amp/compile flags set on CPU"
    print("mixed_precision/compile_model gating OK: both flags set to True on a CPU device ran identically "
          "to the default (correctly gated off outside CUDA) with no crash and finite loss throughout — "
          "the real bf16/fp16+GradScaler and torch.compile paths activate only on an actual CUDA device "
          "(Kaggle's real GPU), which this sandbox doesn't have to verify against directly.")
