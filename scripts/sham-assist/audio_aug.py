"""Voice augmentation for a small CPU-trained audio tokenizer: pitch, formants and tempo variants of audio that was already collected.

A numpy port of src/app/free-tools/talking-photo/voice.ts (our own code): resampling + WSOLA pitch shift, cepstral-envelope formant shift (formants move,
the pitch and the fine structure stay), median-f0 estimate by autocorrelation, and speaker presets (female / girl / deep) defined by a target f0 and a
vocal-tract ratio. numpy only. It PREPARES data only: it never decides what a model says (owner's rule: no keyword/command rules).

Typical use inside a dataset loader, on a mono float waveform at 16 kHz (see README.md for the exact hook):
    y, how = random_augment(wave, 16000, rng)       # y has (almost) the same length; `how` records what was done
"""
from __future__ import annotations

import numpy as np

REF_SR = 22050   # the rate voice.ts works at; parity tests run here


def resample(x: np.ndarray, ratio: float) -> np.ndarray:
    """Linear-interpolation resampling: ratio > 1 makes it shorter (and higher). A light moving average first when going down in rate."""
    x = np.asarray(x, dtype=np.float64)
    src = x
    if ratio > 1.2:
        k = int(round(ratio))
        c = np.cumsum(np.concatenate([[0.0], x]))
        i = np.arange(len(x))
        lo, hi = np.maximum(0, i - k), np.minimum(len(x), i + k + 1)
        src = (c[hi] - c[lo]) / (hi - lo)
    n = int(np.floor(len(src) / ratio))
    p = np.arange(n) * ratio
    k0 = np.floor(p).astype(int)
    f = p - k0
    a = np.where(k0 < len(src), src[np.clip(k0, 0, len(src) - 1)], 0.0)
    b = np.where(k0 + 1 < len(src), src[np.clip(k0 + 1, 0, len(src) - 1)], 0.0)
    return a * (1 - f) + b * f


def wsola(x: np.ndarray, factor: float, sr: int = REF_SR) -> np.ndarray:
    """WSOLA time stretch: output length = input length * factor, pitch unchanged. Window and search range scale with the sample rate."""
    x = np.asarray(x, dtype=np.float64)
    n_win = max(256, 2 * int(round(1024 * sr / REF_SR / 2)))
    ha = n_win // 2
    hs = ha / factor
    s_max = max(16, int(round(128 * sr / REF_SR)))
    out_len = int(np.floor(len(x) * factor)) + n_win
    out = np.zeros(out_len)
    norm = np.zeros(out_len)
    win = 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(n_win) / (n_win - 1))
    prev_start = 0
    step = np.arange(0, ha, 2)
    k = 0
    while True:
        out_pos = k * ha
        if out_pos + n_win > out_len:
            break
        target = int(round(k * hs))
        if target > len(x) - n_win:
            break
        best = target
        if k > 0:
            ref = prev_start + ha
            refseg = x[np.clip(ref + step, 0, len(x) - 1)] * (ref + step < len(x))
            ds = np.arange(-s_max, s_max + 1, 2)
            cands = target + ds
            ok = (cands >= 0) & (cands + n_win <= len(x))
            if ok.any():
                cs = cands[ok]
                scores = x[cs[:, None] + step[None, :]] @ refseg
                best = int(cs[int(np.argmax(scores))])
        out[out_pos: out_pos + n_win] += x[best: best + n_win] * win
        norm[out_pos: out_pos + n_win] += win
        prev_start = best
        k += 1
    m = norm > 1e-3
    out[m] /= norm[m]
    return out[: int(np.floor(len(x) * factor))]


def estimate_f0(x: np.ndarray, sr: int = REF_SR) -> float:
    """Median fundamental frequency (Hz) of the voiced parts, by normalised autocorrelation on up to 160 frames spread over the recording."""
    x = np.asarray(x, dtype=np.float64)
    n = int(round(sr * 0.04))
    min_lag, max_lag = int(np.floor(sr / 420)), int(np.ceil(sr / 70))
    peak = np.abs(x[::7]).max() if len(x) else 0.0
    frames = max(1, int(np.floor((len(x) - n - max_lag) / (sr * 0.01))))
    stride = max(1, frames // 160)
    found = []
    i2 = np.arange(0, n, 2)
    lags = np.arange(min_lag, max_lag + 1)
    for f in range(0, frames, stride):
        s0 = int(np.floor(f * sr * 0.01))
        if s0 + n + max_lag >= len(x):
            break
        base = x[s0 + i2]
        e0 = float((base * base).sum())
        if np.sqrt(e0 / (n / 2)) < 0.08 * peak:
            continue                                   # silence or breath
        shifted = x[s0 + lags[:, None] + i2[None, :]]
        c = shifted @ base
        e1 = (shifted * shifted).sum(axis=1)
        r = c / np.sqrt(e0 * e1 + 1e-12)
        j = int(np.argmax(r))
        if r[j] > 0.55 and lags[j]:
            found.append(sr / lags[j])
    if len(found) < 3:
        return 130.0
    found.sort()
    return float(found[len(found) // 2])


def cepstral_envelope(log_mag: np.ndarray, n: int, lifter: int) -> np.ndarray:
    """Smooth spectral envelope (log magnitude, n/2+1 bins) of one windowed frame by cepstral liftering: it follows the formants, not the harmonics."""
    ceps = np.fft.irfft(log_mag, n=n)
    q = np.arange(n)
    qq = np.minimum(q, n - q)
    ceps = np.where(qq > lifter, 0.0, np.where(qq == lifter, ceps * 0.5, ceps))
    return np.fft.rfft(ceps).real[: n // 2 + 1]


def formant_shift(x: np.ndarray, alpha: float, sr: int = REF_SR) -> np.ndarray:
    """Move every frame's spectral envelope along the frequency axis by alpha (> 1 = shorter vocal tract: a smaller or female voice; < 1 = deeper),
    keeping the fine structure (harmonics, hence the pitch) and the phase."""
    x = np.asarray(x, dtype=np.float64)
    if abs(alpha - 1) < 0.02 or len(x) == 0:
        return x
    n, h = 1024, 256
    win = 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(n) / n)
    lifter = max(14, int(round(sr / 420)))
    out = np.zeros(len(x) + n)
    norm = np.zeros(len(x) + n)
    k = np.arange(n // 2 + 1)
    src = k / alpha
    k0 = np.minimum(n // 2, np.floor(src).astype(int))
    k1 = np.minimum(n // 2, k0 + 1)
    f = src - k0
    for s0 in range(-n + h, len(x), h):
        idx = s0 + np.arange(n)
        seg = np.where((idx >= 0) & (idx < len(x)), x[np.clip(idx, 0, len(x) - 1)], 0.0) * win
        spec = np.fft.rfft(seg)
        mag, ph = np.abs(spec), np.angle(spec)
        log_mag = np.log(mag + 1e-6)
        env = cepstral_envelope(log_mag, n, lifter)
        env_new = np.where(src >= n // 2, env[n // 2], env[k0] * (1 - f) + env[k1] * f)
        m = np.exp(log_mag - env + env_new)
        new = m * np.exp(1j * ph)
        new[0] = new[0].real
        new[n // 2] = new[n // 2].real
        y = np.fft.irfft(new, n=n)
        lo, hi = max(0, s0), min(len(out), s0 + n)
        out[lo:hi] += y[lo - s0: hi - s0] * win[lo - s0: hi - s0]
        norm[lo:hi] += win[lo - s0: hi - s0] ** 2
    m = norm[: len(x)] > 1e-3
    res = out[: len(x)].copy()
    res[m] /= norm[: len(x)][m]
    return res


def pitch_shift(x: np.ndarray, semitones: float, sr: int = REF_SR) -> np.ndarray:
    """Pitch by resampling (formants move with it) then WSOLA back to the original duration."""
    r = 2.0 ** (semitones / 12)
    return wsola(resample(x, r), r, sr)


def reshape_voice(x: np.ndarray, target_hz: float, formant_ratio: float, sr: int = REF_SR) -> np.ndarray:
    """Pitch to target_hz (from the speaker's own median f0) and vocal-tract resonances by formant_ratio overall (1 = as recorded)."""
    f0 = estimate_f0(x, sr)
    ps = min(2.9, max(0.55, target_hz / f0))
    keep = abs(ps - 1) < 0.03
    shifted = x if keep else pitch_shift(x, 12 * np.log2(ps), sr)
    return formant_shift(shifted, formant_ratio / (1 if keep else ps), sr)


# speaker presets used by the talking-photo tool: (target f0 Hz, formant ratio)
PRESETS = {"female": (210.0, 1.17), "girl": (300.0, 1.38), "deep": (85.0, 0.86)}


def apply_preset(x: np.ndarray, name: str, sr: int = REF_SR) -> np.ndarray:
    hz, ratio = PRESETS[name]
    return reshape_voice(x, hz, ratio, sr)


def random_augment(x: np.ndarray, sr: int, rng: np.random.Generator | None = None, *, p_preset: float = 0.35, semitones: float = 2.5,
                   formant: float = 0.12, tempo: float = 0.08) -> tuple[np.ndarray, dict]:
    """One random variant of a waveform (same loudness peak). With probability p_preset a speaker preset (female / girl / deep) is applied; otherwise a
    small pitch shift (+-semitones), formant ratio (1 +- formant) and tempo (1 +- tempo) are drawn. Returns (waveform, record of what was done).
    The length changes only through `tempo` (tempo=0 keeps it); the mel loader cuts fixed-length segments anyway."""
    rng = rng or np.random.default_rng()
    x = np.asarray(x, dtype=np.float64)
    if len(x) < 2048:                       # too short for the overlap-add windows: returned unchanged
        return x.copy(), {"skipped": "too short"}
    peak_in = float(np.abs(x).max()) if len(x) else 0.0
    how: dict = {}
    if rng.random() < p_preset:
        name = list(PRESETS)[int(rng.integers(len(PRESETS)))]
        y = apply_preset(x, name, sr)
        how["preset"] = name
    else:
        st = float(rng.uniform(-semitones, semitones))
        fr_total = float(1 + rng.uniform(-formant, formant))     # vocal-tract change relative to the recording, pitch shift included
        fr = fr_total
        tp = float(1 + rng.uniform(-tempo, tempo)) if tempo > 0 else 1.0
        y = x
        if abs(st) > 0.05:
            y = pitch_shift(y, st, sr)
            fr = fr / (2.0 ** (st / 12))        # resampling moved the formants with the pitch: keep them where they are unless asked
            fr = float(np.clip(fr, 0.6, 1.6))
        y = formant_shift(y, fr, sr)
        if abs(tp - 1) > 0.01:
            y = wsola(y, 1 / tp, sr)
        how.update({"semitones": round(st, 3), "formant": round(fr_total, 3), "tempo": round(tp, 3)})
    peak_out = float(np.abs(y).max()) if len(y) else 0.0
    if peak_in > 0 and peak_out > 0:
        y = y * (peak_in / peak_out)
    return y, how
