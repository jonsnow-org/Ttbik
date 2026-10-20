# Deferred idea (#4): a "motion script" instead of pixels — spec only, nothing built for Sham

A tiny CPU-trained model cannot write convincing video pixels, but it could write a **low-dimensional motion script** that a deterministic renderer draws. Our browser tool already contains such a renderer (`src/app/free-tools/talking-photo/engine.ts`: triangle-mesh warp of MediaPipe landmarks, painted mouth interior, blinks, head pose). Its input is a `Track` sampled at 30 fps:

| Field | Meaning | Range |
|---|---|---|
| `J` | jaw drop | 0..1.15 (1 = an open vowel in ordinary speech; a shout reaches ~2.6 via `level`) |
| `S` | lip spread (smile/“ee”) | 0..1 |
| `R` | lip rounding (“oo”) | 0..1 |
| `F` | teeth/hiss (s, f, th) | 0..1 |
| `E` | loudness envelope (stress, nods, brows) | 0..1 |
| `B` | blink | 0..1 |
| `level` | loudness scale for the jaw | 0.5..2.6 |
| head pose | yaw/pitch/roll noise, drift tuned to SadTalker audio2pose statistics | degrees |

Cheap supervision exists for the first five channels directly from audio: `viseme_check.classify_frames` + the MOUTH table in `viseme.ts` (`refineTrack`) turn any recording into (J, S, R, F) per frame, and `E` from the loudness curve. A model that learns audio-tokens → these ~7 numbers per frame needs few parameters and little data, and the renderer stays mechanical (the model decides *what*, the renderer only draws), which fits the owner's rule for Sham. Not started; the Sham session deferred it. This file is the hand-over of the format if that day comes.
