"""
The CPU designs of the media tokenizers (owner has no GPU, 2026-10-11). Measured on a plain 2-thread CPU (sham_vq_bench.py):

  design                        params   tokens/image   images/hour
  256px base128 (old default)   38.9M    256            1,149      <- one image every 3 s: nothing ever trained
  128px base64  codes 8192      11.4M    64             ~16,700    <- this one (about twice that on the 4-core Lightning Studio)

IMAGE_V2 keeps num_codes = 8192 (the model's reserved image vocabulary, model.IMAGE_VOCAB_SIZE) and the 16x downsample, so every id still maps
into the same slice of the shared vocabulary; only the picture size (128: an 8x8 grid = 64 tokens, four times as many video frames in the same
window) and the width change. The audio tokenizer keeps its shape (80 mels x 256 frames, 80 tokens per 2.56 s): it is already CPU sized.
fingerprint_cfg lets a loader tell the two designs apart without loading weights.
"""
from __future__ import annotations

from audio_tokenizer import AudioTokenizerConfig
from image_tokenizer import ImageTokenizerConfig

IMAGE_V2 = dict(image_size=128, base_channels=64, channel_multipliers=(1, 2, 4, 4), code_dim=256, num_codes=8192, commitment_cost=0.25)


def image_v2_config() -> ImageTokenizerConfig:
    return ImageTokenizerConfig(**IMAGE_V2)


def audio_v2_config() -> AudioTokenizerConfig:
    return AudioTokenizerConfig()


def is_image_v2(cfg) -> bool:
    return cfg.image_size == IMAGE_V2["image_size"] and cfg.base_channels == IMAGE_V2["base_channels"] and cfg.num_codes == IMAGE_V2["num_codes"]


if __name__ == "__main__":
    c = image_v2_config()
    assert c.tokens_per_image == 64 and c.num_codes == 8192 and c.downsample_factor == 16 and is_image_v2(c)
    assert not is_image_v2(ImageTokenizerConfig())
    assert audio_v2_config().num_codes == 2048
    print("sham_media_cfg self-test OK | image v2:", c.image_size, "px,", c.tokens_per_image, "tokens")
