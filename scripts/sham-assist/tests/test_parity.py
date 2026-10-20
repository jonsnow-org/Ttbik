"""Parity of the numpy ports with the TypeScript originals (fixtures/expected.json made by fixtures/gen_fixtures.mjs) plus behaviour checks.
Run from this folder:  python -m unittest discover -s tests -v      (numpy only)"""
import base64
import json
import sys
import unittest
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import audio_aug as A  # noqa: E402
import viseme_check as V  # noqa: E402

FIX = HERE.parent / "fixtures"
INPUT = json.loads((FIX / "input.json").read_text())
EXPECTED = json.loads((FIX / "expected.json").read_text())


def f32(b64):
    return np.frombuffer(base64.b64decode(b64), dtype="<f4").astype(np.float64)


X16, X22 = f32(INPUT["16000"]["b64"]), f32(INPUT["22050"]["b64"])


def ncc(a, b):
    n = min(len(a), len(b))
    a, b = a[:n] - a[:n].mean(), b[:n] - b[:n].mean()
    return float((a @ b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-12))


class VisemeParity(unittest.TestCase):
    def test_mfcc_matches_typescript(self):
        mfcc, le = V.mfcc_frames(X16)
        e = EXPECTED["viseme"]
        self.assertEqual(len(mfcc), e["frames"])
        self.assertLess(np.abs(mfcc[:40] - np.array(e["mfcc"])).max(), 2e-3)
        self.assertLess(np.abs(le[:40] - np.array(e["le"])).max(), 2e-3)

    def test_classification_matches_typescript(self):
        w, active = V.classify_frames(X16, 16000)
        e = EXPECTED["viseme"]
        self.assertGreaterEqual((active == np.array(e["active"])).mean(), 0.98)
        self.assertGreaterEqual((w.argmax(axis=1) == np.array(e["argmax"])).mean(), 0.95)
        self.assertLess(np.abs(w[:30] - np.array(e["weights_first"])).max(), 0.05)

    def test_model_has_expected_shape(self):
        ids, mu, sinv = V.load_model()
        self.assertEqual(mu.shape[1], 12)
        self.assertEqual(sinv.shape[1:], (12, 12))
        self.assertTrue(set(ids.tolist()) <= set(range(15)))


class VisemeBehaviour(unittest.TestCase):
    def test_identical_audio_agrees_fully(self):
        self.assertEqual(V.viseme_agreement(X16, X16, 16000), 1.0)
        self.assertEqual(V.viseme_agreement(X16, X16, 16000, mode="hard"), 1.0)

    def test_ranking_follows_the_damage(self):
        rng = np.random.default_rng(3)
        rms = float(np.sqrt((X16 ** 2).mean()))
        scores = [V.viseme_agreement(X16, X16 + rng.standard_normal(len(X16)) * rms / 10 ** (snr / 20), 16000) for snr in (40, 20, 5)]
        self.assertGreater(scores[0], scores[1])
        self.assertGreater(scores[1], scores[2])

    def test_gate_is_relative(self):
        rng = np.random.default_rng(4)
        rms = float(np.sqrt((X16 ** 2).mean()))
        noisy = X16 + rng.standard_normal(len(X16)) * rms / 10 ** (40 / 20)     # a clean-ish decoder
        muddy = X16 + rng.standard_normal(len(X16)) * rms / 10 ** (5 / 20)      # a muddy one
        better = V.no_worse([X16], [muddy], [noisy], 16000)
        worse = V.no_worse([X16], [noisy], [muddy], 16000)
        self.assertTrue(better["ok"])
        self.assertFalse(worse["ok"])

    def test_degraded_audio_agrees_less(self):
        rng = np.random.default_rng(1)
        noisy = X16 + rng.standard_normal(len(X16)) * 0.25          # heavy noise: the decoder "muddied" the speech
        shuffled = np.concatenate([X16[len(X16) // 2:], X16[: len(X16) // 2]])
        self.assertLess(V.viseme_agreement(X16, noisy, 16000), 0.8)
        self.assertLess(V.viseme_agreement(X16, shuffled, 16000), 0.8)

    def test_silence_has_no_speaking_frames(self):
        w, active = V.classify_frames(np.zeros(16000), 16000)
        self.assertFalse(active.any())
        self.assertTrue((w[:, V.SIL] == 1).all())


class AudioParity(unittest.TestCase):
    def test_f0_matches_typescript(self):
        self.assertLess(abs(A.estimate_f0(X22, 22050) / EXPECTED["voice"]["f0"] - 1), 0.01)

    def test_pitch_shift_matches_typescript(self):
        ts = f32(EXPECTED["voice"]["pitch_shift_5"])
        py = A.pitch_shift(X22, 5)
        self.assertLess(abs(len(py) - len(ts)), 4)
        self.assertGreater(ncc(py, ts), 0.97)
        self.assertLess(abs(np.sqrt((py ** 2).mean()) / np.sqrt((ts ** 2).mean()) - 1), 0.03)

    def test_formant_shift_matches_typescript(self):
        ts = f32(EXPECTED["voice"]["formant_117"])
        py = A.formant_shift(X22, 1.17, 22050)
        self.assertEqual(len(py), len(ts))
        self.assertGreater(ncc(py, ts), 0.97)

    def test_reshape_female_matches_typescript(self):
        ts = f32(EXPECTED["voice"]["reshape_female"])
        py = A.reshape_voice(X22, 210, 1.17)
        self.assertLess(abs(len(py) - len(ts)), 4)
        self.assertGreater(ncc(py, ts), 0.95)


def centroid(x, sr):
    s = np.abs(np.fft.rfft(x * np.hanning(len(x))))
    f = np.fft.rfftfreq(len(x), 1 / sr)
    return float((s * f).sum() / s.sum())


class AudioBehaviour(unittest.TestCase):
    def test_octave_up_doubles_the_pitch_and_keeps_the_length(self):
        y = A.pitch_shift(X22, 12)
        self.assertLess(abs(len(y) / len(X22) - 1), 0.02)
        self.assertLess(abs(A.estimate_f0(y, 22050) / (2 * A.estimate_f0(X22, 22050)) - 1), 0.06)

    def test_formant_shift_moves_the_envelope_not_the_pitch(self):
        y = A.formant_shift(X22, 1.2, 22050)
        self.assertLess(abs(A.estimate_f0(y, 22050) / A.estimate_f0(X22, 22050) - 1), 0.04)
        self.assertGreater(centroid(y, 22050), centroid(X22, 22050) * 1.03)

    def test_works_at_16k(self):
        y = A.pitch_shift(X16, -3, 16000)
        self.assertLess(abs(len(y) / len(X16) - 1), 0.02)
        z = A.formant_shift(X16, 0.9, 16000)
        self.assertEqual(len(z), len(X16))

    def test_random_augment_is_reproducible_and_keeps_the_peak(self):
        a, how_a = A.random_augment(X16, 16000, np.random.default_rng(5), p_preset=0)
        b, how_b = A.random_augment(X16, 16000, np.random.default_rng(5), p_preset=0)
        self.assertEqual(how_a, how_b)
        self.assertTrue(np.array_equal(a, b))
        self.assertAlmostEqual(float(np.abs(a).max()), float(np.abs(X16).max()), places=4)
        self.assertLess(abs(len(a) / len(X16) - 1), 0.12)       # tempo is at most +-8 %

    def test_presets_move_the_pitch_the_right_way(self):
        f0 = A.estimate_f0(X22, 22050)
        self.assertGreater(A.estimate_f0(A.apply_preset(X22, "girl"), 22050), f0 * 1.5)
        self.assertLess(A.estimate_f0(A.apply_preset(X22, "deep"), 22050), f0 * 0.8)

    def test_silence_and_tiny_input_do_not_crash(self):
        for x in (np.zeros(5000), np.zeros(3), np.array([0.1])):
            y, _ = A.random_augment(x, 16000, np.random.default_rng(0), p_preset=0)
            self.assertTrue(np.isfinite(y).all())


if __name__ == "__main__":
    unittest.main()
