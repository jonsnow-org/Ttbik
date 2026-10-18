"""
The media tokenizers on a CPU-only machine (owner has no GPU, 2026-10-11) — WITHOUT going smaller (owner: "never go backwards").

Measured on a plain 2-thread CPU (sham_vq_bench.py), images per hour of the full design at each size:
    256 px  1,149      128 px  ~4,700      64 px  ~19,000 (about four times fewer pixels each step down)
A smaller network would be faster but lowers the quality ceiling, so the DESIGN stays the full one (38.9M params, 256 px, 256 tokens, 8192 codes).
What changes is how it is trained: IMAGE_RES_MIX draws each step's picture size from {64, 128, 256}. The network is fully convolutional, so one set
of weights serves every size: most steps are cheap small pictures, some are full size, and a GPU later simply makes every step faster.

image_config() = the unchanged default ImageTokenizerConfig(); audio keeps its CPU-sized design (80 mels x 256 frames, 80 tokens per 2.56 s).
"""
from __future__ import annotations

from audio_tokenizer import AudioTokenizerConfig
from image_tokenizer import ImageTokenizerConfig

IMAGE_RES_MIX = {64: 0.55, 128: 0.30, 256: 0.15}


def image_config() -> ImageTokenizerConfig:
    return ImageTokenizerConfig()


def audio_config() -> AudioTokenizerConfig:
    return AudioTokenizerConfig()


if __name__ == "__main__":
    c = image_config()
    assert c.image_size == 256 and c.base_channels == 128 and c.num_codes == 8192 and c.tokens_per_image == 256
    assert abs(sum(IMAGE_RES_MIX.values()) - 1.0) < 1e-9 and all(256 % s == 0 for s in IMAGE_RES_MIX)
    assert audio_config().num_codes == 2048
    cost = sum(p * (s / 256) ** 2 for s, p in IMAGE_RES_MIX.items())
    print(f"sham_media_cfg self-test OK | full design kept; mix costs {cost:.2f}x of always-256 per step (~{1 / cost:.1f}x more images per hour)")
