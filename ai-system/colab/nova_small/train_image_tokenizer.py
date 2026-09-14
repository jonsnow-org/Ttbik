"""
Nova Small — real VQ-VAE training loop for image_tokenizer.py.

Every test of ImageTokenizer so far (image_tokenizer.py's own __main__,
the multimodal integration tests) used RANDOM weights — proof the
architecture's shapes/gradients/round-trip mechanics are correct, but
a randomly-initialized codebook turns any real image into meaningless
noise. This file is the tool that actually trains it. Two real,
well-documented VQ-VAE failure modes are checked for directly here,
not assumed absent:

  1. Does reconstruction loss actually go down? A training loop that
     runs without crashing but never reduces loss is a common silent
     failure (e.g. a learning rate that's wrong, or a loss term that
     dominates the others) — checked by comparing real measured loss
     across epochs, not just "it ran."
  2. Codebook collapse: a well-documented VQ-VAE pathology where the
     encoder ends up only ever choosing 1-2 codes out of the whole
     codebook, no matter how large the codebook is — checked by
     directly counting how many distinct codes actually get used.

Honestly scoped: run directly (`python3 train_image_tokenizer.py`),
this trains a SMALL variant on a small SYNTHETIC dataset with real
repeated structure (not just noise) — proof the training loop itself
is mechanically correct and free of the two failure modes above, fast
enough to run on CPU. The real production tokenizer (image_size=256,
the full default config) needs training on a real, large, image
dataset on a real GPU (Kaggle) — a separate, later step that reuses
this exact train_vqvae() function, per the "keep training as the final
stage" plan.
"""

from dataclasses import dataclass
from pathlib import Path

import torch
import torch.nn as nn

from image_tokenizer import ImageTokenizer, ImageTokenizerConfig


def make_synthetic_image_dataset(
    num_samples: int, num_patterns: int, image_size: int, channels: int = 3, noise_std: float = 0.05, seed: int = 0
) -> torch.Tensor:
    """A real, structured (not pure-noise) dataset: num_patterns fixed
    base images, each instance a small random perturbation of one of
    them. VQ-VAE reconstruction loss on pure noise can't meaningfully
    decrease (there's nothing to learn), so this is what makes "loss
    goes down" a real signal that gradients/optimization are working,
    not an artifact of the data having no structure at all."""
    generator = torch.Generator().manual_seed(seed)
    patterns = torch.rand(num_patterns, channels, image_size, image_size, generator=generator) * 2 - 1
    indices = torch.randint(0, num_patterns, (num_samples,), generator=generator)
    noise = torch.randn(num_samples, channels, image_size, image_size, generator=generator) * noise_std
    return (patterns[indices] + noise).clamp(-1, 1)


@dataclass
class TrainStats:
    epoch_losses: list[float]
    final_codebook_usage: int
    codebook_size: int


def train_vqvae(
    tokenizer: ImageTokenizer,
    images: torch.Tensor,
    num_epochs: int,
    batch_size: int,
    lr: float = 3e-4,
    device: str = "cpu",
    log_every: int = 10,
) -> TrainStats:
    tokenizer.to(device)
    images = images.to(device)
    optimizer = torch.optim.AdamW(tokenizer.parameters(), lr=lr)

    num_samples = images.shape[0]
    epoch_losses = []
    all_token_ids_last_epoch = []

    for epoch in range(num_epochs):
        permutation = torch.randperm(num_samples)
        epoch_loss_sum = 0.0
        epoch_token_ids = []

        for start in range(0, num_samples, batch_size):
            batch_indices = permutation[start : start + batch_size]
            batch = images[batch_indices]

            _, token_ids, loss = tokenizer(batch)
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()

            epoch_loss_sum += loss.item() * batch.shape[0]
            if epoch == num_epochs - 1:
                epoch_token_ids.append(token_ids.detach().reshape(-1))

        epoch_avg_loss = epoch_loss_sum / num_samples
        epoch_losses.append(epoch_avg_loss)
        if epoch % log_every == 0 or epoch == num_epochs - 1:
            print(f"  epoch {epoch + 1}/{num_epochs}: avg reconstruction+VQ loss = {epoch_avg_loss:.4f}")

        if epoch == num_epochs - 1:
            all_token_ids_last_epoch = torch.cat(epoch_token_ids)

    final_usage = int(torch.unique(all_token_ids_last_epoch).numel())
    return TrainStats(epoch_losses=epoch_losses, final_codebook_usage=final_usage, codebook_size=tokenizer.cfg.num_codes)


def save_tokenizer_checkpoint(path: str | Path, tokenizer: ImageTokenizer, step: int) -> None:
    """Same self-describing-checkpoint principle as checkpoint.py for
    the main model: the config travels WITH the weights so a later load
    never has to guess ImageTokenizerConfig's fields."""
    payload = {"config": tokenizer.cfg.__dict__, "step": step, "state_dict": tokenizer.state_dict()}
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    torch.save(payload, tmp_path)
    tmp_path.replace(path)


def load_tokenizer_checkpoint(path: str | Path, map_location: str = "cpu") -> tuple[ImageTokenizer, int]:
    payload = torch.load(path, map_location=map_location, weights_only=False)
    cfg = ImageTokenizerConfig(**payload["config"])
    tokenizer = ImageTokenizer(cfg)
    tokenizer.load_state_dict(payload["state_dict"])
    return tokenizer, payload["step"]


if __name__ == "__main__":
    import tempfile

    torch.manual_seed(0)

    # A small config for a fast, real CPU smoke test — the exact same
    # ImageTokenizer/train_vqvae code the full 256x256/8192-code default
    # config will use for real training on Kaggle's GPU later.
    small_cfg = ImageTokenizerConfig(
        image_size=32, base_channels=16, channel_multipliers=(1, 2, 2, 2), code_dim=32, num_codes=64
    )
    tokenizer = ImageTokenizer(small_cfg)

    dataset = make_synthetic_image_dataset(num_samples=64, num_patterns=8, image_size=small_cfg.image_size)
    print(f"training on {dataset.shape[0]} synthetic images built from {8} repeated base patterns "
          f"(real learnable structure, not pure noise)")

    stats = train_vqvae(tokenizer, dataset, num_epochs=40, batch_size=8, lr=1e-3, log_every=10)

    first_loss, last_loss = stats.epoch_losses[0], stats.epoch_losses[-1]
    assert last_loss < first_loss * 0.5, (
        f"loss did not meaningfully decrease ({first_loss:.4f} -> {last_loss:.4f}) — the training loop "
        f"may be broken (wrong LR, gradients not flowing, etc.)"
    )
    print(f"\nloss decreased meaningfully: {first_loss:.4f} -> {last_loss:.4f} "
          f"({(1 - last_loss / first_loss) * 100:.0f}% reduction) — real evidence gradients are flowing "
          f"and the optimizer is actually learning, not just running.")

    assert stats.final_codebook_usage > 1, (
        f"codebook collapsed to {stats.final_codebook_usage} code(s) out of {stats.codebook_size} — "
        f"the classic VQ-VAE failure mode this file's own docstring warns about"
    )
    print(f"codebook usage OK: {stats.final_codebook_usage}/{stats.codebook_size} distinct codes actually "
          f"used on the final epoch — no collapse.")

    with tempfile.TemporaryDirectory() as tmpdir:
        ckpt_path = Path(tmpdir) / "image_tokenizer_step40.pt"
        save_tokenizer_checkpoint(ckpt_path, tokenizer, step=40)
        reloaded, reloaded_step = load_tokenizer_checkpoint(ckpt_path)
        assert reloaded_step == 40
        for (name, p_orig), (_, p_loaded) in zip(tokenizer.named_parameters(), reloaded.named_parameters()):
            assert torch.equal(p_orig, p_loaded), f"weight mismatch after reload: {name}"
        with torch.no_grad():
            sample = dataset[:2]
            original_recon, _, _ = tokenizer(sample)
            reloaded_recon, _, _ = reloaded(sample)
            assert torch.equal(original_recon, reloaded_recon), "reloaded tokenizer produces different output"
    print("checkpoint save/load OK: trained weights round-trip exactly and reproduce identical output.")

    print("\nAll VQ-VAE image tokenizer training checks passed — the trainer is mechanically correct, "
          "with no codebook collapse, on a small real smoke test. Full-scale training on a real image "
          "dataset happens later, on Kaggle's GPU, reusing this exact code.")
