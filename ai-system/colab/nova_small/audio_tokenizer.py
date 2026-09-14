"""
Nova Small — audio tokenizer (a small VQ-VAE), the audio counterpart to
image_tokenizer.py: the mechanical "translator" between a real audio
mel-spectrogram and the discrete audio tokens NovaSmall's own brain
(model.py) generates directly, as part of the SAME autoregressive
sequence it already generates text and image tokens in.

Owner spec, 2026-09-14 ("نبني نماذج مصغرة وندمجها في عقل نموذجنا" ,
confirmed again for all four modalities: "نص صوت صور فديو"): exactly
the same split as image_tokenizer.py and for the same reason — this
module never decides WHAT sound to produce, only:
  - encode(): compress a real mel-spectrogram into a short sequence of
    discrete token ids from a fixed codebook.
  - decode(): turn such a sequence of ids back into a real
    mel-spectrogram.
All of the actual "what to say/play" reasoning lives in NovaSmall's own
transformer, exactly as for text and images.

Real, well-established technique: representing audio as discrete codes
from a small convolutional VQ codebook operating on a mel-spectrogram
is the same family of approach used by real published audio-token
systems (SoundStream/EnCodec-style neural audio codecs, and Jukebox's
VQ-VAE audio tokens) — not a novel/unverified idea.

Sizing: works on a fixed-length log-mel-spectrogram segment
(n_mels=80 frequency bins x 256 time frames — roughly 2.56s of audio
at a 100Hz frame rate, a real, usable utterance-length chunk), treated
as a single-channel "image" and downsampled 16x on both axes (four
stride-2 stages, exactly mirroring image_tokenizer.py's own stages) to
a 5x16 grid -> 80 discrete tokens per segment, codebook of 2048
entries (smaller than the image codebook's 8192, since a compressed
mel-spectrogram patch carries less independent visual detail than an
image patch does). See count_parameters() below and this file's own
__main__ block for real, run verification of both the parameter count
and a live encode/decode round trip — the exact same "prove it before
shipping it" pattern image_tokenizer.py's own verification used.

Input contract: this module operates on a mel-spectrogram tensor
(batch, 1, n_mels, segment_frames), not a raw waveform — computing the
mel-spectrogram itself (e.g. via torchaudio.transforms.MelSpectrogram)
is a deterministic, well-tested signal-processing step with no
learned parameters, and is deliberately kept out of this owned/trained
component so this file's verification can focus entirely on the part
that is actually novel here (the learned codebook and its gradient
flow), exactly as image_tokenizer.py already assumes its caller hands
it a real image tensor rather than doing JPEG decoding itself.
"""

from dataclasses import dataclass

import torch
import torch.nn as nn
import torch.nn.functional as F


@dataclass
class AudioTokenizerConfig:
    n_mels: int = 80
    segment_frames: int = 256
    in_channels: int = 1
    base_channels: int = 64
    channel_multipliers: tuple[int, ...] = (1, 2, 4, 4)  # 4 stages -> 16x downsample on both axes
    code_dim: int = 128
    num_codes: int = 2048
    commitment_cost: float = 0.25

    @property
    def downsample_factor(self) -> int:
        return 2 ** len(self.channel_multipliers)

    @property
    def latent_mel_bins(self) -> int:
        if self.n_mels % self.downsample_factor != 0:
            raise ValueError(
                f"n_mels ({self.n_mels}) must be divisible by the downsample factor "
                f"({self.downsample_factor}, from {len(self.channel_multipliers)} stride-2 stages)"
            )
        return self.n_mels // self.downsample_factor

    @property
    def latent_time_steps(self) -> int:
        if self.segment_frames % self.downsample_factor != 0:
            raise ValueError(
                f"segment_frames ({self.segment_frames}) must be divisible by the downsample factor "
                f"({self.downsample_factor})"
            )
        return self.segment_frames // self.downsample_factor

    @property
    def tokens_per_segment(self) -> int:
        return self.latent_mel_bins * self.latent_time_steps


class ResBlock(nn.Module):
    def __init__(self, channels: int):
        super().__init__()
        self.norm1 = nn.GroupNorm(min(32, channels), channels)
        self.conv1 = nn.Conv2d(channels, channels, kernel_size=3, padding=1)
        self.norm2 = nn.GroupNorm(min(32, channels), channels)
        self.conv2 = nn.Conv2d(channels, channels, kernel_size=3, padding=1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        h = self.conv1(F.silu(self.norm1(x)))
        h = self.conv2(F.silu(self.norm2(h)))
        return x + h


class Encoder(nn.Module):
    """Same generic conv-stage pattern as image_tokenizer.Encoder, on a
    (mel bins x time frames) grid instead of (height x width) — the
    downsample math only cares that both axes are divisible by 16, and
    a mel-spectrogram is exactly a 2D grid like an image is."""

    def __init__(self, cfg: AudioTokenizerConfig):
        super().__init__()
        channels = [cfg.base_channels * m for m in cfg.channel_multipliers]
        self.stem = nn.Conv2d(cfg.in_channels, channels[0], kernel_size=3, padding=1)

        stages = []
        in_ch = channels[0]
        for out_ch in channels:
            stages.append(nn.Sequential(
                ResBlock(in_ch) if in_ch == out_ch else nn.Conv2d(in_ch, out_ch, kernel_size=1),
                nn.Conv2d(out_ch, out_ch, kernel_size=4, stride=2, padding=1),  # halves both axes
            ))
            in_ch = out_ch
        self.stages = nn.ModuleList(stages)

        self.mid = ResBlock(channels[-1])
        self.to_latent = nn.Conv2d(channels[-1], cfg.code_dim, kernel_size=1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        h = self.stem(x)
        for stage in self.stages:
            h = stage(h)
        h = self.mid(h)
        return self.to_latent(h)  # (batch, code_dim, latent_mel_bins, latent_time_steps)


class Decoder(nn.Module):
    def __init__(self, cfg: AudioTokenizerConfig):
        super().__init__()
        channels = [cfg.base_channels * m for m in cfg.channel_multipliers]
        self.from_latent = nn.Conv2d(cfg.code_dim, channels[-1], kernel_size=1)
        self.mid = ResBlock(channels[-1])

        stages = []
        reversed_channels = list(reversed(channels))
        in_ch = reversed_channels[0]
        for out_ch in reversed_channels[1:] + [reversed_channels[-1]]:
            stages.append(nn.Sequential(
                nn.ConvTranspose2d(in_ch, out_ch, kernel_size=4, stride=2, padding=1),  # doubles both axes
                ResBlock(out_ch) if in_ch == out_ch else nn.Conv2d(out_ch, out_ch, kernel_size=1),
            ))
            in_ch = out_ch
        self.stages = nn.ModuleList(stages)

        self.to_spectrogram = nn.Conv2d(channels[0], cfg.in_channels, kernel_size=3, padding=1)

    def forward(self, z: torch.Tensor) -> torch.Tensor:
        h = self.mid(self.from_latent(z))
        for stage in self.stages:
            h = stage(h)
        return torch.tanh(self.to_spectrogram(h))  # normalized log-mel values in [-1, 1]


class VectorQuantizer(nn.Module):
    """Identical mechanism to image_tokenizer.VectorQuantizer (same real
    van den Oord et al. 2017 codebook + commitment loss, same
    straight-through estimator) — a separate class rather than a shared
    import because this file must stand on its own as a from-scratch,
    fully-owned component, exactly like every other file in this
    directory, not a hidden dependency on image_tokenizer.py."""

    def __init__(self, cfg: AudioTokenizerConfig):
        super().__init__()
        self.num_codes = cfg.num_codes
        self.code_dim = cfg.code_dim
        self.commitment_cost = cfg.commitment_cost
        self.codebook = nn.Embedding(cfg.num_codes, cfg.code_dim)
        nn.init.uniform_(self.codebook.weight, -1.0 / cfg.num_codes, 1.0 / cfg.num_codes)

    def forward(self, z: torch.Tensor):
        batch, code_dim, mel_bins, time_steps = z.shape
        z_flat = z.permute(0, 2, 3, 1).reshape(-1, code_dim)

        distances = (
            z_flat.pow(2).sum(dim=1, keepdim=True)
            - 2 * z_flat @ self.codebook.weight.t()
            + self.codebook.weight.pow(2).sum(dim=1)
        )
        token_ids = torch.argmin(distances, dim=1)
        quantized_flat = self.codebook(token_ids)

        quantized = quantized_flat.view(batch, mel_bins, time_steps, code_dim).permute(0, 3, 1, 2)

        codebook_loss = F.mse_loss(quantized, z.detach())
        commitment_loss = F.mse_loss(quantized.detach(), z)
        vq_loss = codebook_loss + self.commitment_cost * commitment_loss

        quantized = z + (quantized - z).detach()  # straight-through estimator

        token_ids = token_ids.view(batch, mel_bins, time_steps)
        return quantized, token_ids, vq_loss


class AudioTokenizer(nn.Module):
    def __init__(self, cfg: AudioTokenizerConfig):
        super().__init__()
        self.cfg = cfg
        self.encoder = Encoder(cfg)
        self.quantizer = VectorQuantizer(cfg)
        self.decoder = Decoder(cfg)

    def encode(self, mel_spectrograms: torch.Tensor) -> torch.Tensor:
        """mel_spectrograms: (batch, 1, n_mels, segment_frames), values
        normalized to [-1, 1]. Returns (batch, latent_mel_bins,
        latent_time_steps) integer token ids."""
        z = self.encoder(mel_spectrograms)
        _, token_ids, _ = self.quantizer(z)
        return token_ids

    def decode(self, token_ids: torch.Tensor) -> torch.Tensor:
        """token_ids: (batch, latent_mel_bins, latent_time_steps)
        integers in [0, num_codes). Returns a reconstructed
        mel-spectrogram in [-1, 1]."""
        quantized = self.quantizer.codebook(token_ids).permute(0, 3, 1, 2)
        return self.decoder(quantized)

    def forward(self, mel_spectrograms: torch.Tensor):
        z = self.encoder(mel_spectrograms)
        quantized, token_ids, vq_loss = self.quantizer(z)
        reconstruction = self.decoder(quantized)
        recon_loss = F.mse_loss(reconstruction, mel_spectrograms)
        total_loss = recon_loss + vq_loss
        return reconstruction, token_ids, total_loss

    def count_parameters(self) -> int:
        return sum(p.numel() for p in self.parameters())


def build_default_tokenizer() -> AudioTokenizer:
    return AudioTokenizer(AudioTokenizerConfig())


if __name__ == "__main__":
    tokenizer = build_default_tokenizer()
    n_params = tokenizer.count_parameters()
    print(f"AudioTokenizer parameter count: {n_params:,} ({n_params / 1e6:.1f}M)")
    print(f"tokens per audio segment: {tokenizer.cfg.tokens_per_segment} "
          f"(grid {tokenizer.cfg.latent_mel_bins}x{tokenizer.cfg.latent_time_steps})")

    batch = 2
    dummy_mels = torch.rand(batch, 1, tokenizer.cfg.n_mels, tokenizer.cfg.segment_frames) * 2 - 1
    reconstruction, token_ids, loss = tokenizer(dummy_mels)

    expected_recon_shape = (batch, 1, tokenizer.cfg.n_mels, tokenizer.cfg.segment_frames)
    assert reconstruction.shape == expected_recon_shape, f"unexpected reconstruction shape {reconstruction.shape}"
    assert token_ids.shape == (batch, tokenizer.cfg.latent_mel_bins, tokenizer.cfg.latent_time_steps), (
        f"unexpected token_ids shape {token_ids.shape}"
    )
    assert token_ids.min() >= 0 and token_ids.max() < tokenizer.cfg.num_codes, (
        f"token ids out of range: [{token_ids.min().item()}, {token_ids.max().item()}]"
    )
    assert torch.isfinite(loss), f"loss is not finite: {loss}"
    print(f"forward pass OK: reconstruction shape={tuple(reconstruction.shape)}, "
          f"token_ids shape={tuple(token_ids.shape)} (range [{token_ids.min().item()}, {token_ids.max().item()}]), "
          f"loss={loss.item():.4f}")

    tokenizer.zero_grad()
    loss.backward()
    encoder_grad_norm = sum(p.grad.norm().item() for p in tokenizer.encoder.parameters() if p.grad is not None)
    assert encoder_grad_norm > 0, "encoder received zero gradient — the straight-through estimator is broken"
    print(f"gradient flow OK: encoder total grad norm = {encoder_grad_norm:.4f} (must be > 0)")

    token_ids_only = tokenizer.encode(dummy_mels)
    assert torch.equal(token_ids_only, token_ids), "encode() and forward()'s internal encoding disagree"
    decoded = tokenizer.decode(token_ids_only)
    assert decoded.shape == expected_recon_shape, f"decode() produced unexpected shape {decoded.shape}"
    print("encode()/decode() round trip OK: shapes and ids consistent end to end.")
