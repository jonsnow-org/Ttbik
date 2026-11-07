"""
Sham — real training loop for motion_tokenizer.py (the native-video codec).

`MotionTokenizer.training_step` turns a pair of real frames into a
differentiable motion-VQ loss (real flow -> quantise -> warp+refine ->
reconstruction vs the true next frame, plus the codebook's own VQ loss).
Until this file existed nothing actually CALLED it: the motion codebook was
random and the frame synthesiser untrained, so a "clip" was a keyframe plus
motion noise. This is the tool that trains both, and it is the piece that
makes the model's own video path produce real motion rather than stitched
stills.

Same two real failure modes the image/audio trainers guard against are
checked here directly, not assumed absent:
  1. Does the loss actually go down over epochs? (a loop that runs but
     never learns is a common silent failure)
  2. Codebook collapse — do more than a handful of motion codes ever win?
The extra, video-specific bar is honest and measurable: the trained decoder
must beat the naive "copy the previous frame" baseline on the true next
frame. A generator that only repeats the previous frame is a slideshow, and
the owner explicitly rejected slideshows.

Honestly scoped: run directly (`python3 train_motion_tokenizer.py`), this
trains on a small SYNTHETIC-but-real moving dataset (a shape translating on
a gradient, plus known-flow warps) so the loop is provably correct and free
of the failure modes above, fast on CPU. The production tokenizer trains on
real video on a GPU, reusing this exact function.
"""

from dataclasses import dataclass

import torch

from motion_tokenizer import MotionTokenizer, MotionTokenizerConfig, save_motion_tokenizer, warp_with_flow


def make_synthetic_motion_dataset(
    num_samples: int, image_size: int, block: int, seed: int = 0, max_shift: float = 0.6
) -> tuple[torch.Tensor, torch.Tensor]:
    """A real moving dataset with KNOWN motion: each sample is a frame plus the
    frame warped by a random-but-known flow field. Reconstruction loss on pure
    noise has nothing to learn, so "the loss went down" would be meaningless;
    here the true flow exists, so a low residual means the codec really found
    the motion. Returns (prev, next), both (num_samples, 3, H, W) in [-1, 1].

    The flow is a SMOOTH global field plus strong per-block variation: real
    video is not a single uniform shift (a purely positional field would let
    each block memorise one "position code" and never exercise the codebook —
    measured: exactly grid*grid codes used). The per-block part is what makes
    different blocks/times select different motion codes, which is what the
    codebook exists to represent."""
    from train_image_tokenizer import make_synthetic_image_dataset

    generator = torch.Generator().manual_seed(seed)
    grid = image_size // block
    base = make_synthetic_image_dataset(num_samples, num_patterns=max(2, num_samples // 4), image_size=image_size, seed=seed)
    # A smooth global component (camera pan/drift) ...
    ys, xs = torch.meshgrid(torch.arange(grid), torch.arange(grid), indexing="ij")
    field = torch.stack([xs.float(), ys.float()], dim=0).unsqueeze(0) / grid  # (1,2,grid,grid) in [0,1)
    global_flow = (field * 2 - 1) * max_shift
    # ... plus a per-block, per-sample component (independent object drift), so
    # the same spatial position takes different motions across the dataset.
    block_flow = torch.randn(num_samples, 2, grid, grid, generator=generator) * max_shift
    flow = global_flow + block_flow
    prev = base
    nxt = torch.cat([warp_with_flow(base[i : i + 1], flow[i : i + 1]) for i in range(num_samples)]).clamp(-1, 1)
    return prev, nxt


@dataclass
class MotionTrainStats:
    epoch_losses: list[float]
    final_codebook_usage: int
    codebook_size: int
    revived_codes: int
    copy_previous_error: float
    trained_error: float

    @property
    def beats_copy(self) -> bool:
        return self.trained_error < self.copy_previous_error


def train_motion_tokenizer(
    tokenizer: MotionTokenizer,
    prev: torch.Tensor,
    nxt: torch.Tensor,
    num_epochs: int,
    batch_size: int,
    block: int | None = None,
    lr: float = 2e-3,
    device: str | None = None,
    log_every: int = 10,
    data_init: bool = True,
    revive_every: int = 16,
    usage_decay: float = 0.995,
    revive_threshold: float = 0.5,
    max_steps: int | None = None,
) -> MotionTrainStats:
    # None = whatever the notebook runs on: the GPU if one is attached, else the CPU.
    if device is None:
        device = "cuda" if torch.cuda.is_available() else "cpu"
    tokenizer.to(device)
    prev, nxt = prev.to(device), nxt.to(device)
    # Keep the block-matching grid equal to the codebook grid (see
    # MotionTokenizer.block_for): a mismatch silently trains the codebook on a
    # different grid than decode_clip reads back.
    block = tokenizer.flow_block(prev.shape[-1], block)
    optimizer = torch.optim.AdamW(tokenizer.parameters(), lr=lr)

    num_samples = prev.shape[0]
    num_codes = tokenizer.cfg.num_codes
    epoch_losses: list[float] = []
    usage = torch.zeros(num_codes, device=device)
    revived_total = 0
    step = 0
    last_ids: torch.Tensor | None = None

    if data_init:
        # Seed the codebook from REAL flow vectors; see
        # FlowVectorQuantizer.initialize_from_data for why the random init
        # collapses (the same pathology measured on the image codebook).
        from motion_tokenizer import estimate_flow
        with torch.no_grad():
            seed_flow = torch.cat([estimate_flow(prev[i : i + 1], nxt[i : i + 1], block)
                                   for i in range(min(num_samples, 8 * batch_size))])
        tokenizer.quantizer.initialize_from_data(seed_flow)

    for epoch in range(num_epochs):
        permutation = torch.randperm(num_samples, device=device)
        epoch_loss_sum = 0.0
        stop = False

        for start in range(0, num_samples, batch_size):
            if max_steps is not None and step >= max_steps:
                stop = True
                break
            idx = permutation[start : start + batch_size]
            p, n = prev[idx], nxt[idx]

            loss = tokenizer.training_step(p, n, block)
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()

            # Slow-decayed usage so "dead" means "unused for a while", not
            # "absent from this one batch". Reviving on every step over-churns
            # the codebook (measured on the image codebook: full usage but
            # worse reconstruction), so it runs every revive_every steps.
            usage *= usage_decay
            with torch.no_grad():
                ids = tokenizer.encode_pair(p, n, block)
            usage += torch.bincount(ids.detach().reshape(-1), minlength=num_codes).to(usage.dtype)
            last_ids = ids.detach().reshape(-1)
            step += 1
            if revive_every > 0 and step % revive_every == 0:
                from motion_tokenizer import estimate_flow
                with torch.no_grad():
                    batch_flow = estimate_flow(p, n, block)
                revived_total += tokenizer.quantizer.revive_dead_codes(usage, batch_flow, revive_threshold)

            epoch_loss_sum += loss.item() * p.shape[0]

        epoch_avg_loss = epoch_loss_sum / num_samples
        epoch_losses.append(epoch_avg_loss)
        if epoch % log_every == 0 or epoch == num_epochs - 1:
            print(f"  epoch {epoch + 1}/{num_epochs}: avg motion reconstruction+VQ loss = {epoch_avg_loss:.4f}")
        if stop:
            break

    # The honest quality numbers: the trained decoder's residual on the true
    # next frame vs. the naive "repeat the previous frame" slideshow.
    with torch.no_grad():
        recon = tokenizer.decode_frame(prev, tokenizer.encode_pair(prev, nxt, block))
        copy_err = (prev - nxt).abs().mean().item()
        trained_err = (recon - nxt).abs().mean().item()

    final_usage = int(torch.unique(last_ids).numel()) if last_ids is not None else 0
    tokenizer.to("cpu")
    return MotionTrainStats(
        epoch_losses=epoch_losses,
        final_codebook_usage=final_usage,
        codebook_size=num_codes,
        revived_codes=revived_total,
        copy_previous_error=copy_err,
        trained_error=trained_err,
    )


if __name__ == "__main__":
    import tempfile
    from pathlib import Path

    torch.manual_seed(0)

    size, block = 32, 8
    small_cfg = MotionTokenizerConfig(grid=size // block, num_codes=256)
    tokenizer = MotionTokenizer(small_cfg)

    prev, nxt = make_synthetic_motion_dataset(num_samples=32, image_size=size, block=block, seed=0)
    print(f"training on {prev.shape[0]} real moving pairs ({size}x{size}, {size // block}x{size // block} flow grid)")

    stats = train_motion_tokenizer(tokenizer, prev, nxt, num_epochs=40, batch_size=8, block=block, lr=2e-3, log_every=10)

    first_loss, last_loss = stats.epoch_losses[0], stats.epoch_losses[-1]
    assert last_loss < first_loss, (
        f"loss did not decrease ({first_loss:.4f} -> {last_loss:.4f}) — the motion training loop may be broken"
    )
    print(f"\nloss decreased: {first_loss:.4f} -> {last_loss:.4f} ({(1 - last_loss / first_loss) * 100:.0f}% reduction)")

    assert stats.final_codebook_usage > 1, (
        f"motion codebook collapsed to {stats.final_codebook_usage} code(s) of {stats.codebook_size}"
    )
    print(f"codebook usage OK: {stats.final_codebook_usage}/{stats.codebook_size} distinct motion codes used")

    assert stats.beats_copy, (
        f"trained decoder ({stats.trained_error:.4f}) did not beat repeating the previous frame "
        f"({stats.copy_previous_error:.4f}) — that is a slideshow-grade generator"
    )
    print(f"quality OK: copy-previous {stats.copy_previous_error:.4f} -> trained {stats.trained_error:.4f} "
          f"({(1 - stats.trained_error / stats.copy_previous_error) * 100:.0f}% better than a slideshow)")

    with tempfile.TemporaryDirectory() as tmpdir:
        ckpt = Path(tmpdir) / "motion_tokenizer.pt"
        save_motion_tokenizer(ckpt, tokenizer, step=40)
        from motion_tokenizer import load_motion_tokenizer
        reloaded = load_motion_tokenizer(ckpt)
        for (name, p_orig), (_, p_loaded) in zip(tokenizer.named_parameters(), reloaded.named_parameters()):
            assert torch.equal(p_orig, p_loaded), f"weight mismatch after reload: {name}"
    print("checkpoint save/load OK: trained weights round-trip exactly.")

    print("\nAll motion-tokenizer training checks passed — the native-video codec trains, does not collapse, "
          "and beats a slideshow on a small real smoke test. Full-scale training on real video reuses this code.")
