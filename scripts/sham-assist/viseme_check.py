"""Speech-intelligibility check from the voice: MFCC + Mahalanobis viseme classifier, a numpy port of src/app/free-tools/talking-photo/viseme.ts.

Method: HeadAudio by Mika Suominen (MIT, https://github.com/met4citizen/HeadAudio), following hecomi's uLipSync / wLipSync (MIT). The pre-trained model
`fixtures/viseme-model.bin` is HeadAudio's `model-en-mixed.bin` (MIT, licence in fixtures/LICENSE-HeadAudio.txt).
16 kHz audio -> pre-emphasis 0.97 -> 512-sample Hamming frames every 256 samples -> power spectrum -> 40 mel bands (30..7800 Hz) -> log10 -> DCT (12 coeffs)
-> lifter -> tanh -> Mahalanobis distance to 39 Gaussian prototypes of 15 visemes -> soft-min weights per viseme.

It PREPARES and MEASURES only: it never decides what the model says or draws (owner's rule: no keyword/command rules).
numpy only. Everything is float64 internally; the TypeScript original is float32, so parity is checked with tolerances (tests/test_parity.py).
"""
from __future__ import annotations

from pathlib import Path

import numpy as np

SR, N, HOP, BANDS, COEFF, LIFTER = 16000, 512, 256, 40, 12, 22
SIL = 14
VIS_NAMES = ["aa", "E", "I", "O", "U", "PP", "SS", "TH", "DD", "FF", "kk", "nn", "RR", "CH", "sil"]
TEMPERATURE = 2.5          # soft-min temperature over Mahalanobis distances (same as the TypeScript)
VOICE_GATE = -4.2          # log10 frame power above which someone is speaking (HeadAudio's gate, about -42 dB)
DEFAULT_MODEL = Path(__file__).parent / "fixtures" / "viseme-model.bin"


def load_model(path: str | Path = DEFAULT_MODEL):
    """-> (viseme_ids [P], mu [P, 12], sigma_inv [P, 12, 12]) from HeadAudio's binary (little-endian float32 records:
    2 header floats (viseme id is byte 7), 12 means, 78 lower-triangular inverse-covariance values)."""
    buf = Path(path).read_bytes()
    rec_len = 2 + COEFF + COEFF * (COEFF + 1) // 2
    rec_bytes = rec_len * 4
    ids, mus, sigs = [], [], []
    tri = np.tril_indices(COEFF)
    for pos in range(0, len(buf) - rec_bytes + 1, rec_bytes):
        ids.append(buf[pos + 7])
        mu = np.frombuffer(buf, dtype="<f4", count=COEFF, offset=pos + 8).astype(np.float64)
        low = np.frombuffer(buf, dtype="<f4", count=COEFF * (COEFF + 1) // 2, offset=pos + 8 + COEFF * 4).astype(np.float64)
        s = np.zeros((COEFF, COEFF))
        s[tri] = low                                   # row-major lower triangle, as in the TypeScript loop
        s = s + s.T - np.diag(np.diag(s))              # symmetric inverse covariance
        mus.append(mu)
        sigs.append(s)
    if not ids:
        raise ValueError("empty viseme model")
    return np.array(ids), np.array(mus), np.array(sigs)


def to_16k(x: np.ndarray, sr: int) -> np.ndarray:
    """Mono -> 16 kHz by windowed-sinc low-pass + interpolation (same idea as the TypeScript; vectorised)."""
    x = np.asarray(x, dtype=np.float64)
    if abs(sr - SR) < 1:
        return x
    ratio = sr / SR
    n = int(np.floor(len(x) / ratio))
    taps = 16
    cut = min(0.45, 0.45 / max(1.0, ratio))
    c = np.arange(n) * ratio
    out = np.zeros(n)
    wsum = np.zeros(n)
    base = np.round(c).astype(int)
    for j in range(-taps, taps + 1):
        k = base + j
        u = k - c
        ok = (k >= 0) & (k < len(x))
        with np.errstate(divide="ignore", invalid="ignore"):
            s = np.where(u == 0, 2 * cut, np.sin(2 * np.pi * cut * u) / (np.pi * u))
        w = s * (0.54 + 0.46 * np.cos(np.pi * u / (taps + 1)))
        v = np.where(ok, x[np.clip(k, 0, len(x) - 1)], 0.0)
        out += np.where(ok, v * w, 0.0)
        wsum += np.where(ok, w, 0.0)
    return np.where(wsum != 0, out / np.where(wsum != 0, wsum, 1), 0.0)


def _filterbank() -> np.ndarray:
    mel = lambda f: 2595 * np.log10(1 + f / 700)
    mel_inv = lambda m: 700 * (10 ** (m / 2595) - 1)
    lo, hi = mel(30), mel(7800)
    pts = [int(np.floor(mel_inv(lo + (hi - lo) / (BANDS + 1) * i) / SR * N)) for i in range(BANDS + 2)]
    fb = np.zeros((BANDS, N // 2))
    for b in range(BANDS):
        for k in range(pts[b], pts[b + 1]):
            fb[b, k] = (k - pts[b]) / max(1, pts[b + 1] - pts[b])
        for k in range(pts[b + 1], pts[b + 2]):
            fb[b, k] = (pts[b + 2] - k) / max(1, pts[b + 2] - pts[b + 1])
    return fb


_FB = _filterbank()
_DCT = np.sqrt(2 / BANDS) * np.cos(np.pi * (np.arange(1, COEFF + 1)[:, None]) * (np.arange(BANDS)[None, :] + 0.5) / BANDS)
_LIFT = 1 + (LIFTER / 2) * np.sin(np.pi * (np.arange(COEFF) + 1) / LIFTER)
_HAMMING = 0.54 - 0.46 * np.cos(2 * np.pi * np.arange(N) / (N - 1))


def mfcc_frames(x16: np.ndarray):
    """-> (mfcc [T, 12] tanh-compressed, le [T] log10 frame power)."""
    x16 = np.asarray(x16, dtype=np.float64)
    pe = x16.copy()
    pe[1:] -= 0.97 * x16[:-1]
    frames = max(0, (len(pe) - N) // HOP + 1)
    if frames == 0:
        return np.zeros((0, COEFF)), np.zeros(0)
    idx = np.arange(N)[None, :] + HOP * np.arange(frames)[:, None]
    seg = pe[idx] * _HAMMING
    spec = np.fft.rfft(seg, n=N, axis=1)[:, : N // 2]            # bins 0..255 (the TypeScript keeps N/2 bins)
    power = (spec.real ** 2 + spec.imag ** 2) / N
    le = np.log10(power.sum(axis=1) + 1e-10)
    en = np.log10(power @ _FB.T + 1e-10)
    mfcc = np.tanh((en @ _DCT.T) * _LIFT)
    return mfcc, le


def classify_frames(x: np.ndarray, sr: int, model=None):
    """-> (weights [T, 15] soft weight per viseme, active [T] bool). Silence frames get weight 1 on 'sil'."""
    ids, mu, sinv = model if model is not None else load_model()
    mfcc, le = mfcc_frames(to_16k(x, sr))
    if len(mfcc) == 0:
        return np.zeros((0, len(VIS_NAMES))), np.zeros(0, dtype=bool)
    diff = mfcc[:, None, :] - mu[None, :, :]                       # [T, P, 12]
    d = np.einsum("tpi,pij,tpj->tp", diff, sinv, diff)            # Mahalanobis (squared form, as in the TypeScript)
    d = np.where(ids[None, :] == SIL, d / 1.2, d)
    dmin = np.full((len(mfcc), len(VIS_NAMES)), np.inf)
    for v in range(len(VIS_NAMES)):
        m = ids == v
        if m.any():
            dmin[:, v] = d[:, m].min(axis=1)
    base = dmin.min(axis=1, keepdims=True)
    w = np.where(np.isfinite(dmin), np.exp(-(dmin - base) / TEMPERATURE), 0.0)
    w /= np.maximum(w.sum(axis=1, keepdims=True), 1e-300)
    active = le > VOICE_GATE
    w[~active] = 0.0
    w[~active, SIL] = 1.0
    return w, active


def viseme_sequence(x: np.ndarray, sr: int, model=None, smooth: int = 3) -> np.ndarray:
    """Hard viseme id per frame (16 ms), after a small majority smoothing so single-frame flicker does not count."""
    w, _ = classify_frames(x, sr, model)
    if len(w) == 0:
        return np.zeros(0, dtype=int)
    if smooth > 1:
        k = np.ones(smooth) / smooth
        w = np.stack([np.convolve(np.pad(w[:, v], (smooth // 2, smooth // 2), mode="edge"), k, mode="valid") for v in range(w.shape[1])], axis=1)
    return w.argmax(axis=1)


def viseme_agreement(reference: np.ndarray, reconstructed: np.ndarray, sr: int = SR, model=None, mode: str = "soft") -> float:
    """How alike the phonetic content of two recordings is, 0..1, higher is better, over the frames where the REFERENCE is speaking.
    mode="soft" (default): overlap of the soft viseme weights, sum(min(w_ref, w_rec)) per frame, averaged. Smooth, usable range about 0.45..1.
    mode="hard": share of frames with the same arg-max viseme. Much harsher (a 30 dB-SNR copy already scores ~0.4) but ranks the same way.
    IMPORTANT: use it as a RELATIVE gate between two candidates measured on the SAME fixed sample (see `no_worse`), never as an absolute threshold, and
    NEXT TO the mel reconstruction error, not instead of it. The classifier was trained on clean English speech and reacts to tiny perturbations."""
    n = min(len(reference), len(reconstructed))
    wa, aa = classify_frames(np.asarray(reference[:n]), sr, model)
    wb, _ = classify_frames(np.asarray(reconstructed[:n]), sr, model)
    t = min(len(wa), len(wb))
    if t == 0:
        return 1.0
    wa, wb, speaking = wa[:t], wb[:t], aa[:t]
    if not speaking.any():
        return 1.0
    if mode == "hard":
        return float((wa[speaking].argmax(axis=1) == wb[speaking].argmax(axis=1)).mean())
    return float(np.minimum(wa[speaking], wb[speaking]).sum(axis=1).mean())


def no_worse(references, current, candidate, sr: int = SR, tol: float = 0.02, model=None) -> dict:
    """The gate for decoder refinement: `references` is the fixed sample of original waveforms, `current` / `candidate` the same items decoded by the
    published decoder and by the refined one. Returns {"current": a, "candidate": b, "ok": b >= a - tol}; publish only if mel error improved AND ok."""
    cur = float(np.mean([viseme_agreement(r, c, sr, model) for r, c in zip(references, current)]))
    cand = float(np.mean([viseme_agreement(r, c, sr, model) for r, c in zip(references, candidate)]))
    return {"current": cur, "candidate": cand, "ok": cand >= cur - tol}


def spectral_distance(reference: np.ndarray, reconstructed: np.ndarray, sr: int = SR) -> float:
    """Mean distance of the MFCC frames (a second, phonetic view of the same pair; lower is better)."""
    n = min(len(reference), len(reconstructed))
    a, _ = mfcc_frames(to_16k(reference[:n], sr))
    b, _ = mfcc_frames(to_16k(reconstructed[:n], sr))
    t = min(len(a), len(b))
    return float(np.abs(a[:t] - b[:t]).mean()) if t else 0.0
