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

import os

from audio_tokenizer import AudioTokenizerConfig
from image_tokenizer import ImageTokenizerConfig

def _image_size() -> int:
    """SHAM_IMG_SIZE: picture side of the image tokenizer (default 256 = the current design, 16x16 = 256 tokens). A multiple of 16; 384 gives a 24x24 grid = 576 tokens (2.25x the pixels), 512 gives 1024.
    Only a NEW lineage (sham-image-tokenizer-hd-checkpoint, see lightning/tokenizer_job.py) is ever trained at another size: the serving tokenizer is never changed by this setting."""
    try:
        size = int(os.environ.get("SHAM_IMG_SIZE") or 256)
    except ValueError:
        return 256
    return size if size % 16 == 0 and 256 <= size <= 512 else 256


IMG_SIZE = _image_size()
IMAGE_RES_MIX = {IMG_SIZE // 4: 0.55, IMG_SIZE // 2: 0.30, IMG_SIZE: 0.15}      # {64:.55, 128:.30, 256:.15} at the default


def image_config() -> ImageTokenizerConfig:
    return ImageTokenizerConfig(image_size=IMG_SIZE)


def audio_config() -> AudioTokenizerConfig:
    return AudioTokenizerConfig()


if __name__ == "__main__":
    c = image_config()
    assert c.image_size == IMG_SIZE and c.base_channels == 128 and c.num_codes == 8192
    if IMG_SIZE == 256:
        assert c.tokens_per_image == 256
    assert abs(sum(IMAGE_RES_MIX.values()) - 1.0) < 1e-9 and all(IMG_SIZE % s == 0 for s in IMAGE_RES_MIX)
    assert audio_config().num_codes == 2048
    cost = sum(p * (s / 256) ** 2 for s, p in IMAGE_RES_MIX.items())
    print(f"sham_media_cfg self-test OK | full design kept; mix costs {cost:.2f}x of always-256 per step (~{1 / cost:.1f}x more images per hour)")
