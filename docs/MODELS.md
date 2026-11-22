# Model registry (owner rules 2026-11-04)

Every model is independent: its own inference Studio(s), its own media Studio(s) and weights, and its own computer (`chatKey = <chat>:<model>`).
No model calls another model's Studio, and nothing silently falls back to another model. When a route is not configured, the user gets an honest error.
Code: `src/lib/coderModels.ts` (registry), `src/lib/openCoderStudio.ts` (engine pools), `src/lib/modelMedia.ts` (media routing),
`src/lib/novaBotLogic.ts` and `src/lib/shamStudio.ts` (Sham).

| id | Name | Who can use it | Inference (own) | Image (own) | Speech + video (own) |
|---|---|---|---|---|---|
| `coder` | Nova AI (Qwen3.5-4B Q4_K_M) | everyone (free tier: 3 images + 3 videos a day; owner unlimited) | `coder-inference-server`, `-2` … `-5` (`OPEN_CODER_STUDIO_URL(S)`) | `epicrealism-image-test` (`NOVA_IMAGE_STUDIO_URL`) | Nova media Studio (`NOVA_MEDIA_URL`) |
| `sham_v2` | Sham 2 (copy of Sham 1 + donor weights; T-LDM via owner switch, openable later) | owner; visibility toggle; T-LDM owner switch | `sham-v2-server` (+ overflow) | (none: its own internal generator) | Sham v2 makes all media itself, like v1 (2026-11-08) |
| `sham` | Sham v1 | owner | open (being retrained from scratch; work on it freely — owner's order 2026-11-06) | — | — |
| `freei` | free i (OpenRouter agent through GitHub; a flag on the chat, not a model of this app: see docs/START_HERE.md §4) | owner only | none | none | none |

## Removed candidates (owner's order 2026-11-08)
Qwen3.5-9B, Gemma 4 E4B and MiniCPM-o 4.5 are deleted from the registry, the picker, the bot, the Mini App, the tests, the experiments folder and their workflows. Same-harness numbers that decided it (2 cores, nova-local-eval.yml): Gemma 4 E4B 5/6 tools 6/6 code 4 tok/s 8.2 GB; Qwen3.5-9B 5/6 6/6 3 tok/s 9.9 GB; MiniCPM-o 0.4-0.9 tok/s. None beat Nova (Qwen3.5-4B, 6/6 6/6, 6-8 tok/s, 5.8 GB) in the real task test.


## Env names (values are never documented)
`MEDIA_SHOW_PROMPT=1`: owner raw-test only; shows the generator prompt as a caption (off by default).
