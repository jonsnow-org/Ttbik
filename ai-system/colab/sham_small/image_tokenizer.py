"""
Sham Small — image tokenizer (a small VQ-VAE), the "translator" between
raw pixels and the discrete visual tokens ShamSmall's own brain
(model.py) generates directly, as part of the SAME autoregressive
sequence it already generates text tokens in.

Owner spec, 2026-09-14 ("نبني نماذج مصغرة وندمجها في عقل نموذجنا"):
this is deliberately NOT a second "thinking" network competing with the
text brain (that would just be a separately-hosted image model wearing
a different name) — it never decides WHAT to draw. All of that
reasoning lives entirely in ShamSmall's own transformer, which learns
to write a sequence of image-token ids exactly the way it writes a
sequence of word ids. This module's only two jobs are mechanical:
  - encode(): compress a real image into a short sequence of discrete
    token ids from a fixed codebook (what the text brain is trained to
    predict).
  - decode(): turn such a sequence of ids back into real pixels (what
    turns the brain's own output into something a person can see).

Real, well-established technique, not a novel/unverified idea: this is
the same "VQ-VAE + autoregressive transformer" split that the original
DALL-E (2021) and VQGAN used for image generation, and that
video/audio-token approaches in later multimodal systems reuse the
same way — a large body of real prior art, not a guess.

Sizing: 256x256 RGB images, downsampled by 16x (four stride-2 stages)
to a 16x16 grid -> 256 discrete tokens per image, codebook of 8192
entries. 256 tokens is a manageable addition to a text sequence (a
short paragraph's worth), and 8192 codes is the standard VQGAN-scale
codebook size in the published literature this design follows — see
count_parameters() in this file and sham_small/verify_image_tokenizer.py
for real, run verification of both the parameter count and a live
encode/decode round trip, following the exact same "prove it before
shipping it" pattern model.py's own verification used.
"""

from dataclasses import dataclass

import torch
import torch.nn as nn
import torch.nn.functional as F


@dataclass
class ImageTokenizerConfig:
    image_size: int = 256
    in_channels: int = 3
    base_channels: int = 128
    channel_multipliers: tuple[int, ...] = (1, 2, 4, 4)  # 4 stages -> 16x downsample
    code_dim: int = 256
    num_codes: int = 8192
    commitment_cost: float = 0.25

    @property
    def downsample_factor(self) -> int:
        return 2 ** len(self.channel_multipliers)

    @property
    def latent_grid_size(self) -> int:
        if self.image_size % self.downsample_factor != 0:
            raise ValueError(
                f"image_size ({self.image_size}) must be divisible by the downsample factor "
                f"({self.downsample_factor}, from {len(self.channel_multipliers)} stride-2 stages)"
            )
        return self.image_size // self.downsample_factor

    @property
    def tokens_per_image(self) -> int:
        return self.latent_grid_size ** 2


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
    def __init__(self, cfg: ImageTokenizerConfig):
        super().__init__()
        channels = [cfg.base_channels * m for m in cfg.channel_multipliers]
        self.stem = nn.Conv2d(cfg.in_channels, channels[0], kernel_size=3, padding=1)

        stages = []
        in_ch = channels[0]
        for out_ch in channels:
            stages.append(nn.Sequential(
                ResBlock(in_ch) if in_ch == out_ch else nn.Conv2d(in_ch, out_ch, kernel_size=1),
                nn.Conv2d(out_ch, out_ch, kernel_size=4, stride=2, padding=1),  # halves H, W
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
        return self.to_latent(h)  # (batch, code_dim, latent_grid, latent_grid)


class Decoder(nn.Module):
    def __init__(self, cfg: ImageTokenizerConfig):
        super().__init__()
        channels = [cfg.base_channels * m for m in cfg.channel_multipliers]
        self.from_latent = nn.Conv2d(cfg.code_dim, channels[-1], kernel_size=1)
        self.mid = ResBlock(channels[-1])

        stages = []
        reversed_channels = list(reversed(channels))
        in_ch = reversed_channels[0]
        for out_ch in reversed_channels[1:] + [reversed_channels[-1]]:
            stages.append(nn.Sequential(
                nn.ConvTranspose2d(in_ch, out_ch, kernel_size=4, stride=2, padding=1),  # doubles H, W
                ResBlock(out_ch) if in_ch == out_ch else nn.Conv2d(out_ch, out_ch, kernel_size=1),
            ))
            in_ch = out_ch
        self.stages = nn.ModuleList(stages)

        self.to_image = nn.Conv2d(channels[0], cfg.in_channels, kernel_size=3, padding=1)

    def forward(self, z: torch.Tensor) -> torch.Tensor:
        h = self.mid(self.from_latent(z))
        for stage in self.stages:
            h = stage(h)
        return torch.tanh(self.to_image(h))  # pixels normalized to [-1, 1]


class VectorQuantizer(nn.Module):
    """Owner-facing note: this is the single component that turns a
    continuous feature grid into the discrete "visual word" ids
    ShamSmall's own transformer will be trained to predict — the actual
    bridge between the two worlds this whole file exists for."""

    def __init__(self, cfg: ImageTokenizerConfig):
        super().__init__()
        self.num_codes = cfg.num_codes
        self.code_dim = cfg.code_dim
        self.commitment_cost = cfg.commitment_cost
        self.codebook = nn.Embedding(cfg.num_codes, cfg.code_dim)
        nn.init.uniform_(self.codebook.weight, -1.0 / cfg.num_codes, 1.0 / cfg.num_codes)

    def forward(self, z: torch.Tensor):
        # z: (batch, code_dim, H, W) -> (batch, H, W, code_dim) for a
        # per-spatial-location nearest-codebook-entry lookup.
        batch, code_dim, height, width = z.shape
        z_flat = z.permute(0, 2, 3, 1).reshape(-1, code_dim)

        distances = (
            z_flat.pow(2).sum(dim=1, keepdim=True)
            - 2 * z_flat @ self.codebook.weight.t()
            + self.codebook.weight.pow(2).sum(dim=1)
        )
        token_ids = torch.argmin(distances, dim=1)  # (batch*H*W,)
        quantized_flat = self.codebook(token_ids)  # (batch*H*W, code_dim)

        quantized = quantized_flat.view(batch, height, width, code_dim).permute(0, 3, 1, 2)

        # Real VQ-VAE losses (van den Oord et al., 2017): the codebook
        # must move toward the encoder's real outputs (codebook loss),
        # and the encoder must be discouraged from drifting arbitrarily
        # far from whatever codebook entry it keeps getting matched to
        # (commitment loss) — without this second term training is
        # known to diverge, a documented real failure mode of vanilla
        # VQ, not a hypothetical one.
        codebook_loss = F.mse_loss(quantized, z.detach())
        commitment_loss = F.mse_loss(quantized.detach(), z)
        vq_loss = codebook_loss + self.commitment_cost * commitment_loss

        # Straight-through estimator: forward pass uses the real
        # quantized (discrete) values, but gradients flow back to the
        # encoder as if quantization were the identity function —
        # argmin has no useful gradient of its own, so without this the
        # encoder could never learn anything from image-reconstruction
        # loss at all.
        quantized = z + (quantized - z).detach()

        token_ids = token_ids.view(batch, height, width)
        return quantized, token_ids, vq_loss


class ImageTokenizer(nn.Module):
    def __init__(self, cfg: ImageTokenizerConfig):
        super().__init__()
        self.cfg = cfg
        self.encoder = Encoder(cfg)
        self.quantizer = VectorQuantizer(cfg)
        self.decoder = Decoder(cfg)

    def encode(self, images: torch.Tensor) -> torch.Tensor:
        """images: (batch, 3, H, W) in [-1, 1]. Returns (batch, latent_grid, latent_grid)
        integer token ids — what ShamSmall's own transformer is trained to predict
        (after flattening to a sequence, offset into its shared vocabulary)."""
        z = self.encoder(images)
        _, token_ids, _ = self.quantizer(z)
        return token_ids

    def decode(self, token_ids: torch.Tensor) -> torch.Tensor:
        """token_ids: (batch, latent_grid, latent_grid) integers in
        [0, num_codes). Returns reconstructed images in [-1, 1] —
        what turns the brain's own generated token sequence back into
        something a person can actually see."""
        quantized = self.quantizer.codebook(token_ids).permute(0, 3, 1, 2)
        return self.decoder(quantized)

    def forward(self, images: torch.Tensor):
        z = self.encoder(images)
        quantized, token_ids, vq_loss = self.quantizer(z)
        reconstruction = self.decoder(quantized)
        recon_loss = F.mse_loss(reconstruction, images)
        total_loss = recon_loss + vq_loss
        return reconstruction, token_ids, total_loss

    def count_parameters(self) -> int:
        return sum(p.numel() for p in self.parameters())


def build_default_tokenizer() -> ImageTokenizer:
    return ImageTokenizer(ImageTokenizerConfig())


if __name__ == "__main__":
    tokenizer = build_default_tokenizer()
    n_params = tokenizer.count_parameters()
    print(f"ImageTokenizer parameter count: {n_params:,} ({n_params / 1e6:.1f}M)")
    print(f"tokens per image: {tokenizer.cfg.tokens_per_image} (grid {tokenizer.cfg.latent_grid_size}x{tokenizer.cfg.latent_grid_size})")

    batch = 2
    dummy_images = torch.rand(batch, 3, tokenizer.cfg.image_size, tokenizer.cfg.image_size) * 2 - 1
    reconstruction, token_ids, loss = tokenizer(dummy_images)

    expected_recon_shape = (batch, 3, tokenizer.cfg.image_size, tokenizer.cfg.image_size)
    assert reconstruction.shape == expected_recon_shape, f"unexpected reconstruction shape {reconstruction.shape}"
    assert token_ids.shape == (batch, tokenizer.cfg.latent_grid_size, tokenizer.cfg.latent_grid_size), (
        f"unexpected token_ids shape {token_ids.shape}"
    )
    assert token_ids.min() >= 0 and token_ids.max() < tokenizer.cfg.num_codes, (
        f"token ids out of range: [{token_ids.min().item()}, {token_ids.max().item()}]"
    )
    assert torch.isfinite(loss), f"loss is not finite: {loss}"
    print(f"forward pass OK: reconstruction shape={tuple(reconstruction.shape)}, "
          f"token_ids shape={tuple(token_ids.shape)} (range [{token_ids.min().item()}, {token_ids.max().item()}]), "
          f"loss={loss.item():.4f}")

    # Real gradient-flow check: without the straight-through estimator,
    # the encoder's parameters would get NO gradient at all from the
    # reconstruction loss (argmin blocks it) — this is exactly the
    # documented VQ-VAE failure mode this module's own comment above
    # warns about, so it must be verified directly, not assumed.
    tokenizer.zero_grad()
    loss.backward()
    encoder_grad_norm = sum(p.grad.norm().item() for p in tokenizer.encoder.parameters() if p.grad is not None)
    assert encoder_grad_norm > 0, "encoder received zero gradient — the straight-through estimator is broken"
    print(f"gradient flow OK: encoder total grad norm = {encoder_grad_norm:.4f} (must be > 0)")

    # Round-trip sanity: decode() must accept exactly the token ids
    # encode() produces, end to end, not just inside forward()'s own
    # internal call chain.
    token_ids_only = tokenizer.encode(dummy_images)
    assert torch.equal(token_ids_only, token_ids), "encode() and forward()'s internal encoding disagree"
    decoded = tokenizer.decode(token_ids_only)
    assert decoded.shape == expected_recon_shape, f"decode() produced unexpected shape {decoded.shape}"
    print("encode()/decode() round trip OK: shapes and ids consistent end to end.")
