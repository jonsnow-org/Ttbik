# sham-assist — small helpers that PREPARE and MEASURE data for the Sham model (offered, not imposed)

مقترحات من جلسة الموقع والأدوات لجلسة تدريب شام، قُبلت بالترتيب: (1) زيادة بيانات الصوت، (2) فحص وضوح الكلام كشرط إضافي لتحسين المفكّك، (3) فرز الوجوه **فقط إن قِيس أثره**. لا شيء هنا يضيف قواعد كلمات أو أوامر للبوت أو النموذج؛ كلها تجهّز البيانات وتقيسها. لا يوجد هنا أي مسار من مسارات شام، وتنسخ جلسة شام ما تستعمله إلى شجرتها بنفسها.

Terms agreed on PR #2 (2026-10-20): numpy-only ports, a parity test against our TypeScript, no secrets, **nothing under a Sham path**, no keyword/command rules for the bot or the model. You copy what you use into your own tree.

| File | What | Deps |
|---|---|---|
| `audio_aug.py` | **#2 audio augmentation**: pitch (resample + WSOLA), formant shift (cepstral envelope; pitch kept), tempo, speaker presets (female / girl / deep), `random_augment(x, sr, rng)` | numpy |
| `viseme_check.py` | **#1 speech-intelligibility gate**: HeadAudio MFCC + Mahalanobis viseme classifier (39 prototypes, MIT model in `fixtures/`), `viseme_agreement(ref, rec)`, `no_worse(refs, current, candidate)` | numpy |
| `face_curation.py` | **#3 (only if measured)** MediaPipe face scoring: size, frontal-ness, roll, sharpness, exposure, eyes open, mouth opening | mediapipe==0.10.14, pillow |
| `tests/test_parity.py` | 18 tests: parity with the TypeScript originals (MFCC, classification, f0, pitch shift, formant shift, speaker preset) + behaviour | numpy |
| `fixtures/` | shared deterministic input, TypeScript outputs (`expected.json`, regenerate with `gen_fixtures.mjs`), the viseme model + its MIT licence | — |
| `measure_demo.py`, `demo_gate_with_sham_mel.py` | what the tools do on real wav files; the second one runs the gate through **your** `mel_spectrogram.py` (Griffin-Lim) with stand-in decoders | numpy (+torch for the 2nd) |
| `MOTION_SPEC.md` | the deferred #4: the "motion script" our renderer draws from, as a spec only | — |

Run the tests: `cd scripts/sham-assist && python -m unittest discover -s tests -v` (about 1 s).

## #2 Audio augmentation — how to plug it in, how to judge it
Hook (your `ManifestAudio.__getitem__` in `sham_vq_train.py`, after `wave = load_audio_any(...)`, which is mono 16 kHz float):
```python
import audio_aug                               # copied next to your trainer
if self.augment and random.random() < self.p_aug:           # e.g. p_aug = 0.3, off for the held-out probe
    wave, _ = audio_aug.random_augment(wave, 16000, np.random.default_rng(), p_preset=0.35)
    wave = wave.astype(np.float32)
```
`random_augment`: with p_preset a speaker preset (210 Hz/1.17 female, 300 Hz/1.38 girl, 85 Hz/0.86 deep, the same numbers the tool uses), otherwise pitch ±2.5 semitones, formant ±12 %, tempo ±8 %; the loudness peak is kept; waveforms under 2048 samples are returned unchanged. Cost measured here: one 12 s clip → 0.2 s on one CPU core (≈ 0.015× real time), so a 1,000 s batch of audio costs about 15 s of CPU.
**Judging it (your plan, unchanged):** train two identical audio tokenizers for the same steps/time, one with augmentation; compare reconstruction error on the **fixed held-out pairs** you already use. Keep it only if held-out error improves. Augmented audio must never enter the held-out probe. Do not judge augmentation with the viseme gate: it changes the speaker on purpose.

## #1 Speech-intelligibility gate — what it is, where it sits, what it is NOT
Your decoder-refine decides on the mel reconstruction error of one fixed sample. The gate adds a second, phonetic opinion: decode the sample's mels with the current and the candidate decoder, turn both into audio with **your own** `mel_spectrogram_to_waveform` (Griffin-Lim), and compare against the reference = Griffin-Lim of the *original* mel (so Griffin-Lim artefacts cancel and only the tokenizer's loss is measured):
```python
from viseme_check import no_worse
ref  = [gl(m) for m in original_mels]                 # gl = mel_spectrogram_to_waveform(..., n_fft=512, hop_length=160, griffin_lim_iters=32) -> numpy
cur  = [gl(current_decoder(m)) for m in original_mels]
cand = [gl(candidate_decoder(m)) for m in original_mels]
g = no_worse(ref, cur, cand, 16000, tol=0.02)         # {"current": a, "candidate": b, "ok": b >= a - tol}
publish = mel_error_gain >= min_gain and g["ok"]
```
Facts to keep in mind (measured here, on TTS speech, not on your tokenizers):
- It is **relative only**. Scores of imperfect copies are low in absolute terms (a 30 dB-SNR copy scores ~0.7 soft, ~0.4 hard) because the classifier — trained on clean English speech — reacts to tiny perturbations. Never use an absolute threshold.
- Soft mode (default) has a usable range of about 0.45–1; hard mode (`mode="hard"`) is harsher but ranks alike.
- In the stand-in experiment (`demo_gate_with_sham_mel.py`: noisy / blurred / quantised mels) it ranked the decoders **in the same order as mel MSE**. So its added value is unproven; it is cheap insurance for a later day when mel error alone could mislead. You said audio refinement is refused anyway today (0.0138 → 0.0176): this is low priority, as you ranked it.
- English-trained classes; Arabic shares the vowels a/i/u/e/o and the closed-lip/hiss sounds, but expect a coarser reading.

## #3 Face curation — only if it measures better
`python face_curation.py --model face_landmarker.task img.jpg ...` prints one JSON line per image (`score`, `ok`, factors, raw measures). The model file is Apache-2.0, ~3.7 MB: https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task . Tested here on 5 images (MediaPipe 0.10.14, CPU): single clear face 0.80–0.90 ok; a small face inside a full-body picture 0.14 rejected. It was **not** run at scale and has **no** measured effect on a tokenizer.
**Your A/B (as you proposed):** build the filtered set (e.g. `ok` only) and an unfiltered set of the **same size** (random subset, otherwise the comparison also changes the amount of data); train two identical image tokenizers for the same steps; include the filter only if the held-out error improves. The thresholds in `score()` are a starting rule of thumb, tune them on your data. For captions: the raw measures (`yaw_proxy`, `mouth_open`, `blink`) are labels you may use.

## Honest limits
None of this changes the main blocker you named (training compute, and the model not yet learning when to draw or speak). These are small helpers. The numpy ports are float64, the TypeScript is float32: parity is by tolerance (MFCC < 2e-3, classification ≥ 95 % identical frames, waveform correlation ≥ 0.95–0.97), not bit-exact. Licences: HeadAudio (MIT, model + method), uLipSync/wLipSync (MIT, the idea), MediaPipe (Apache-2.0).
