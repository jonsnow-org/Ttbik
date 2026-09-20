"""
Sham — real VQ-VAE training loop for audio_tokenizer.py. The
audio counterpart to train_image_tokenizer.py; see that file's own
docstring for the full reasoning (why "does loss actually decrease"
and "did the codebook collapse" are both checked directly here rather
than assumed). Same honest scope: a small config trained on a small,
structured synthetic mel-spectrogram dataset, fast enough for a real
CPU smoke test — proof the trainer itself is mechanically correct. The
production audio_tokenizer.py (the full default config) needs real
recorded audio (converted to mel-spectrograms) on a real GPU later,
reusing this exact train_vqvae() function.
"""

from pathlib import Path

import torch

from audio_tokenizer import AudioTokenizer, AudioTokenizerConfig
from train_image_tokenizer import TrainStats  # same stats shape; no reason to redefine it


def make_synthetic_mel_dataset(
    num_samples: int, num_patterns: int, n_mels: int, segment_frames: int, noise_std: float = 0.05, seed: int = 0
) -> torch.Tensor:
    """Same principle as train_image_tokenizer.make_synthetic_image_dataset:
    real repeated structure (num_patterns base mel-spectrograms, each
    instance a small perturbation of one), not pure noise, so a
    decreasing reconstruction loss is real evidence of learning."""
    generator = torch.Generator().manual_seed(seed)
    patterns = torch.rand(num_patterns, 1, n_mels, segment_frames, generator=generator) * 2 - 1
    indices = torch.randint(0, num_patterns, (num_samples,), generator=generator)
    noise = torch.randn(num_samples, 1, n_mels, segment_frames, generator=generator) * noise_std
    return (patterns[indices] + noise).clamp(-1, 1)


def train_vqvae(
    tokenizer: AudioTokenizer,
    mels: torch.Tensor,
    num_epochs: int,
    batch_size: int,
    lr: float = 3e-4,
    device: str = "cpu",
    log_every: int = 10,
) -> TrainStats:
    tokenizer.to(device)
    mels = mels.to(device)
    optimizer = torch.optim.AdamW(tokenizer.parameters(), lr=lr)

    num_samples = mels.shape[0]
    epoch_losses = []
    all_token_ids_last_epoch = []

    for epoch in range(num_epochs):
        permutation = torch.randperm(num_samples)
        epoch_loss_sum = 0.0
        epoch_token_ids = []

        for start in range(0, num_samples, batch_size):
            batch_indices = permutation[start : start + batch_size]
            batch = mels[batch_indices]

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


def save_tokenizer_checkpoint(path: str | Path, tokenizer: AudioTokenizer, step: int) -> None:
    payload = {"config": tokenizer.cfg.__dict__, "step": step, "state_dict": tokenizer.state_dict()}
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    torch.save(payload, tmp_path)
    tmp_path.replace(path)


def load_tokenizer_checkpoint(path: str | Path, map_location: str = "cpu") -> tuple[AudioTokenizer, int]:
    payload = torch.load(path, map_location=map_location, weights_only=False)
    cfg = AudioTokenizerConfig(**payload["config"])
    tokenizer = AudioTokenizer(cfg)
    tokenizer.load_state_dict(payload["state_dict"])
    return tokenizer, payload["step"]


if __name__ == "__main__":
    import tempfile

    torch.manual_seed(0)

    small_cfg = AudioTokenizerConfig(
        n_mels=32, segment_frames=64, base_channels=16, channel_multipliers=(1, 2, 2, 2), code_dim=32, num_codes=64
    )
    tokenizer = AudioTokenizer(small_cfg)

    dataset = make_synthetic_mel_dataset(
        num_samples=64, num_patterns=8, n_mels=small_cfg.n_mels, segment_frames=small_cfg.segment_frames
    )
    print(f"training on {dataset.shape[0]} synthetic mel-spectrograms built from {8} repeated base patterns "
          f"(real learnable structure, not pure noise)")

    stats = train_vqvae(tokenizer, dataset, num_epochs=40, batch_size=8, lr=1e-3, log_every=10)

    first_loss, last_loss = stats.epoch_losses[0], stats.epoch_losses[-1]
    assert last_loss < first_loss * 0.5, (
        f"loss did not meaningfully decrease ({first_loss:.4f} -> {last_loss:.4f}) — the training loop "
        f"may be broken"
    )
    print(f"\nloss decreased meaningfully: {first_loss:.4f} -> {last_loss:.4f} "
          f"({(1 - last_loss / first_loss) * 100:.0f}% reduction).")

    assert stats.final_codebook_usage > 1, (
        f"codebook collapsed to {stats.final_codebook_usage} code(s) out of {stats.codebook_size}"
    )
    print(f"codebook usage OK: {stats.final_codebook_usage}/{stats.codebook_size} distinct codes used — no collapse.")

    with tempfile.TemporaryDirectory() as tmpdir:
        ckpt_path = Path(tmpdir) / "audio_tokenizer_step40.pt"
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

    print("\nAll VQ-VAE audio tokenizer training checks passed — the trainer is mechanically correct, "
          "with no codebook collapse, on a small real smoke test.")
