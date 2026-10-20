"""Shows, on real wav files you point it at, what the two tools do and what they cost (numpy only):
   python measure_demo.py a.wav b.wav ...
For each file: duration, time to make one augmented variant (real-time factor), and the viseme agreement between the original and (a) a mild random
augmentation, (b) the speaker presets, (c) the same audio with noise at 30 and 10 dB SNR and with the band cut at 2 kHz (what a muddy decoder looks like).
It is meant as a RELATIVE gate between two decoders on the same sample: scores of imperfect copies are low in absolute terms and it must never be used
as an absolute threshold, nor on augmented audio (augmentation changes the speaker on purpose). A SECOND opinion beside the mel error, never a replacement."""
import sys
import time
import wave

import numpy as np

import audio_aug as A
import viseme_check as V


def read_wav(path):
    with wave.open(path, "rb") as w:
        sr, ch, width, n = w.getframerate(), w.getnchannels(), w.getsampwidth(), w.getnframes()
        raw = w.readframes(n)
    if width != 2:
        raise SystemExit(f"{path}: only 16-bit PCM wav is read here (use any loader of yours in real use)")
    x = np.frombuffer(raw, dtype="<i2").astype(np.float64) / 32768
    return (x.reshape(-1, ch).mean(axis=1) if ch > 1 else x), sr


def main(paths):
    rng = np.random.default_rng(0)
    for p in paths:
        x, sr = read_wav(p)
        x16 = V.to_16k(x, sr)
        dur = len(x16) / 16000
        t0 = time.time()
        mild, how = A.random_augment(x16, 16000, rng, p_preset=0, semitones=2, formant=0.1, tempo=0)
        dt = time.time() - t0
        row = {"mild": V.viseme_agreement(x16, mild, 16000)}
        for name in A.PRESETS:
            row[name] = V.viseme_agreement(x16, A.apply_preset(x16, name, 16000), 16000)
        rms = np.sqrt((x16 ** 2).mean())
        for snr in (30, 10):
            row[f"noise{snr}dB"] = V.viseme_agreement(x16, x16 + rng.standard_normal(len(x16)) * rms / 10 ** (snr / 20), 16000)
        spec = np.fft.rfft(x16)
        spec[np.fft.rfftfreq(len(x16), 1 / 16000) > 2000] = 0
        row["lowpass2k"] = V.viseme_agreement(x16, np.fft.irfft(spec, n=len(x16)), 16000)
        print(f"{p}: {dur:.1f}s speech | one variant in {dt:.2f}s (x{dt / max(dur, 1e-9):.2f} of real time) | f0 {A.estimate_f0(x16, 16000):.0f} Hz | augment {how}")
        print("   viseme agreement vs original: " + "  ".join(f"{k}={v:.2f}" for k, v in row.items()))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    main(sys.argv[1:])
