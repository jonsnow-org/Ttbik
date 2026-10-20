"""Illustration of where the viseme gate would sit in decoder refinement, using YOUR mel_spectrogram.py (waveform_to_mel_segments /
mel_spectrogram_to_waveform: Griffin-Lim). Needs torch and your folder on the path:
    SHAM_SMALL_DIR=/path/to/ai-system/colab/sham_small python demo_gate_with_sham_mel.py a.wav [b.wav ...]
It builds, for each clip, the reference = the original mel passed through the SAME Griffin-Lim route (so Griffin-Lim artefacts cancel out and only the
tokenizer's loss is measured), then compares three stand-in "decoders": sharp-but-noisy, smooth-but-muddy (temporal blur), and coarse (quantised).
Rows where the two measures DISAGREE about the order of decoders are the only place this gate adds information; in the stand-in runs we did (TTS
speech, three synthetic damages) both measures ranked them the same way, so its extra value is unproven here and it stays cheap insurance.
This is a stand-in experiment on synthetic damage, NOT a measurement of your tokenizers."""
import os
import sys

import numpy as np

sys.path.insert(0, os.environ.get("SHAM_SMALL_DIR", "."))
import torch  # noqa: E402
from mel_spectrogram import mel_spectrogram_to_waveform, waveform_to_mel_segments  # noqa: E402

import viseme_check as V  # noqa: E402
from measure_demo import read_wav  # noqa: E402

N_MELS, SEG = 80, 256


def gl(mel):
    return mel_spectrogram_to_waveform(mel.reshape(N_MELS, -1), 16000, n_fft=512, hop_length=160, griffin_lim_iters=32).numpy().astype(np.float64)


def main(paths):
    g = torch.Generator().manual_seed(0)
    for p in paths:
        x, sr = read_wav(p)
        x16 = torch.from_numpy(V.to_16k(x, sr)).float()
        mel = waveform_to_mel_segments(x16, 16000, N_MELS, SEG, 1)[0]            # (1, 80, 256), 2.56 s
        ref = gl(mel)
        cands = {
            "sharp+noisy": (mel + 0.10 * torch.randn(mel.shape, generator=g)).clamp(-1, 1),
            "smooth+muddy": torch.nn.functional.avg_pool2d(mel.unsqueeze(0), (3, 9), stride=1, padding=(1, 4)).squeeze(0),
            "coarse(6 levels)": torch.round((mel + 1) * 2.5) / 2.5 - 1,
        }
        print(f"{p}: reference = GL(original mel) {len(ref) / 16000:.2f}s")
        for name, m in cands.items():
            err = float(((m - mel) ** 2).mean())
            agree = V.viseme_agreement(ref, gl(m), 16000)
            print(f"   {name:17s} mel MSE={err:.4f}   viseme agreement (soft)={agree:.2f}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    main(sys.argv[1:])
