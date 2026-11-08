# Model registry (owner rules 2026-11-04)

Every model is independent: its own inference Studio(s), its own media Studio(s) and weights, and its own computer (`chatKey = <chat>:<model>`).
No model calls another model's Studio, and nothing silently falls back to another model. When a route is not configured, the user gets an honest error.
Code: `src/lib/coderModels.ts` (registry), `src/lib/openCoderStudio.ts` (engine pools), `src/lib/modelMedia.ts` (media routing),
`src/lib/novaBotLogic.ts` and `src/lib/shamStudio.ts` (Sham).

| id | Name | Who can use it | Inference (own) | Image (own) | Speech + video (own) |
|---|---|---|---|---|---|
| `coder` | Nova AI (Qwen3.5-4B Q4_K_M; LFM2.5 was tried as its brain on 2026-11-08 and rolled back: fast but it invented tool results in a real task) | everyone (free tier: 3 images + 3 videos a day; owner unlimited) | `coder-inference-server`, `-2` … `-5` (`OPEN_CODER_STUDIO_URL(S)`) | `epicrealism-image-test` (`NOVA_IMAGE_STUDIO_URL`) | Nova media Studio (`NOVA_MEDIA_URL`) |
| `lfm25` | LFM2.5 (fast): LiquidAI LFM2.5-8B-A1B Q4_K_M, ctx 32k | owner; visibility toggle | `lfm25-inference-server` (`LFM_STUDIO_URLS`) | `lfm25-media-server` (`LFM_MEDIA_STUDIO_URL`) | `lfm25-media-server` |
| `sham_v2` | Sham v2 (old Sham code + modified donor weights) | owner; visibility toggle | `sham-v2-server` (+ overflow) | `realistic-vision-v6-test` | Sham v2's own media lane |
| `sham` | Sham v1 | owner | open (being retrained from scratch; work on it freely — owner's order 2026-11-06) | — | — |
| `freei` | free i (OpenRouter agent through GitHub; a flag on the chat, not a model of this app: see docs/START_HERE.md §4) | owner only | none | none | none |

## Removed candidates (owner's order 2026-11-08)
Qwen3.5-9B, Gemma 4 E4B and MiniCPM-o 4.5 are deleted from the registry, the picker, the bot, the Mini App, the tests, the experiments folder and their workflows. Same-harness numbers that decided it (2 cores, nova-local-eval.yml): Gemma 4 E4B 5/6 tools 6/6 code 4 tok/s 8.2 GB; Qwen3.5-9B 5/6 6/6 3 tok/s 9.9 GB; MiniCPM-o 0.4-0.9 tok/s. None beat Nova (Qwen3.5-4B, 6/6 6/6, 6-8 tok/s, 5.8 GB) in the real task test. LFM2.5 was tried as Nova's brain and rolled back (it invented a tool result).

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
