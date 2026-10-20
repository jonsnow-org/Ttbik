"""Deterministic test input shared by the TypeScript and the Python implementation: vowel-like voiced segments (harmonics shaped by formant peaks, a
gliding f0), a hissing noise burst and silence. Written as raw float32 (base64) so both sides read identical samples. Run: python fixtures/make_input.py"""
import base64
import json
from pathlib import Path

import numpy as np


def signal(sr: int, seed: int = 7) -> np.ndarray:
    rng = np.random.default_rng(seed)
    out = []
    vowels = [(700, 1200), (300, 2300), (350, 800), (500, 1800)]      # a, i, u, e-like (F1, F2)
    for n, (f1, f2) in enumerate(vowels):
        dur = 0.28
        t = np.arange(int(sr * dur)) / sr
        f0 = 118 + 22 * (t / dur) + 6 * n                              # rising pitch
        phase = 2 * np.pi * np.cumsum(f0) / sr
        y = np.zeros_like(t)
        for h in range(1, int(4000 / 118)):
            fh = h * f0
            amp = np.exp(-((fh - f1) / 130) ** 2) + 0.6 * np.exp(-((fh - f2) / 220) ** 2) + 0.03 / h
            y += amp * np.sin(h * phase)
        y *= np.hanning(len(t)) ** 0.5
        out.append(y / np.abs(y).max() * 0.5)
        out.append(np.zeros(int(sr * 0.06)))
    hiss = rng.standard_normal(int(sr * 0.18))
    hiss = np.diff(hiss, prepend=0)                                     # high-pass-ish noise
    out.append(hiss / np.abs(hiss).max() * 0.2 * np.hanning(len(hiss)))
    out.append(np.zeros(int(sr * 0.08)))
    return np.concatenate(out).astype(np.float32)


if __name__ == "__main__":
    d = {}
    for sr in (16000, 22050):
        x = signal(sr)
        d[str(sr)] = {"n": int(len(x)), "b64": base64.b64encode(x.tobytes()).decode()}
    Path(__file__).with_name("input.json").write_text(json.dumps(d))
    print({k: v["n"] for k, v in d.items()})
