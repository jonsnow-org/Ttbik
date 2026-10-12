"""
How fast does a tokenizer design train on a plain CPU (the owner has no GPU, 2026-10-11)? Measured, not guessed: images (or mel segments) per
second for forward + backward + optimizer step, and parameters, for several designs. The numbers decide the CPU design.
  python sham_vq_bench.py            (prints one line per design)
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "colab" / "sham_small"))
from audio_tokenizer import AudioTokenizer, AudioTokenizerConfig  # noqa: E402
from image_tokenizer import ImageTokenizer, ImageTokenizerConfig  # noqa: E402


def bench(model, x, steps: int = 4) -> float:
    model.train(True)
    opt = torch.optim.AdamW(model.parameters(), lr=1e-4)
    for i in range(steps + 1):
        if i == 1:
            t0 = time.time()
        _, _, loss = model(x)
        opt.zero_grad()
        loss.backward()
        opt.step()
    return x.shape[0] * steps / (time.time() - t0)


def main() -> int:
    torch.set_num_threads(max(1, torch.get_num_threads()))
    print(f"threads={torch.get_num_threads()}")
    for size, base, mult, codes, code_dim in ((256, 128, (1, 2, 4, 4), 8192, 256), (128, 128, (1, 2, 4, 4), 8192, 256),
                                              (128, 96, (1, 2, 4, 4), 8192, 256), (128, 64, (1, 2, 4, 4), 8192, 256),
                                              (128, 64, (1, 2, 4, 4), 4096, 128), (64, 64, (1, 2, 4, 4), 4096, 128)):
        cfg = ImageTokenizerConfig(image_size=size, base_channels=base, channel_multipliers=mult, num_codes=codes, code_dim=code_dim)
        m = ImageTokenizer(cfg)
        x = torch.rand(8, 3, size, size) * 2 - 1
        ips = bench(m, x)
        print(f"image {size}px base{base} codes{codes}: {m.count_parameters() / 1e6:.1f}M params, {cfg.tokens_per_image} tokens/image, "
              f"{ips:.1f} img/s => {ips * 3600:,.0f} img/h", flush=True)
    for base, mult in ((96, (1, 2, 4, 4)), (64, (1, 2, 4, 4)), (32, (1, 2, 4, 4))):      # GroupNorm uses 32 groups: widths must divide by 32 (48 crashed the 2026-10-11 run)
        cfg = AudioTokenizerConfig(base_channels=base, channel_multipliers=mult)
        m = AudioTokenizer(cfg)
        x = torch.rand(16, 1, cfg.n_mels, cfg.segment_frames) * 2 - 1
        sps = bench(m, x)
        print(f"audio base{base}: {m.count_parameters() / 1e6:.1f}M params, {cfg.tokens_per_segment} tokens/segment, {sps:.1f} seg/s => "
              f"{sps * 3600:,.0f} seg/h ({sps * 3600 * 2.56 / 3600:.0f} h of sound per hour)", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
