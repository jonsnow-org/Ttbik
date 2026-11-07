# Model registry (owner rules 2026-11-04)

Every model is independent: its own inference Studio(s), its own media Studio(s) and weights, and its own computer (`chatKey = <chat>:<model>`).
No model calls another model's Studio, and nothing silently falls back to another model. When a route is not configured, the user gets an honest error.
Code: `src/lib/coderModels.ts` (registry), `src/lib/openCoderStudio.ts` (engine pools), `src/lib/modelMedia.ts` (media routing),
`src/lib/donorTests.ts` (candidates), `src/lib/novaBotLogic.ts` and `src/lib/shamStudio.ts` (Sham).

| id | Name | Who can use it | Inference (own) | Image (own) | Speech + video (own) |
|---|---|---|---|---|---|
| `coder` | Nova AI (Qwen3.5-4B Q4_K_M) | everyone (free tier: 3 images + 3 videos a day; owner unlimited) | `coder-inference-server`, `-2` … `-5` (`OPEN_CODER_STUDIO_URL(S)`) | `epicrealism-image-test` (`NOVA_IMAGE_STUDIO_URL`) | Nova media Studio (`NOVA_MEDIA_URL`) |
| `lfm25` | LFM2.5 (fast): LiquidAI LFM2.5-8B-A1B Q4_K_M, ctx 32k | owner; visibility toggle | `lfm25-inference-server` (`LFM_STUDIO_URLS`) | `lfm25-media-server` (`LFM_MEDIA_STUDIO_URL`) | `lfm25-media-server` |
| `qwen35-9b` | Qwen3.5-9B candidate | owner only (locked) | `sham-donor-qwen35-9b-*` | `cyberrealistic-final-test` | `sham-donor-qwen35-9b-media` |
| `gemma4-e4b` | Gemma 4 E4B candidate | owner only (locked) | `sham-donor-gemma4-e4b-*` | `gemma4-realistic-vision-v6-test` | `sham-donor-gemma4-e4b-media` |
| `minicpmo45` | MiniCPM-o 4.5 candidate | owner only (locked) | `sham-donor-minicpmo45-*` | `umranz-sd15-image-test` | `sham-donor-minicpmo45-media` |
| `sham_v2` | Sham v2 (old Sham code + modified donor weights) | owner; visibility toggle | `sham-v2-server` (+ overflow) | `realistic-vision-v6-test` | Sham v2's own media lane |
| `sham` | Sham v1 | owner | open (being retrained from scratch; work on it freely — owner's order 2026-11-06) | — | — |

## LFM2.5 (the "forgotten fast candidate")
It was measured on 2026-11-02 (about 58 tok/s reading, 11.6 tok/s writing on 2 vCPU) but was then hidden inside Nova's pool as replica 4 (`MODEL_OVERRIDES`).
It also became the media-prompt translator for every model. Both overlaps are removed:
- `MODEL_OVERRIDES` now names only `lfm25-inference-server`. A Studio with an override serves only that model: `app.py` has no fallback list for it.
- Nova's replica 4 returns to Qwen3.5-4B, and Nova's pool drops any address containing `lfm` or listed in `LFM_STUDIO_URLS`.
- A request runs inside `withEngineModel(<selected model>)` (`handleCoderSections`, `drive`). New completions go only to that model's pool. A job id carries a global index, so it is always polled on the Studio that took it.
- Deploy: `deploy-modelscope-coder.yml` (the Studio list includes `lfm25-inference-server`), and `deploy-lfm25-media.yml` (a one-time copy of the media package into private `novaai2026/lfm25-media-models`, then the `lfm25-media-server` Studio).

## Env names (values are never documented)
`LFM_STUDIO_URLS`: optional; defaults to the `lfm25-inference-server` address; `off` disables it.
`LFM_MEDIA_STUDIO_URL`: optional; defaults to the `lfm25-media-server` address; `off` disables it.
`MEDIA_SHOW_PROMPT=1`: owner raw-test only; shows the generator prompt as a caption (off by default).
