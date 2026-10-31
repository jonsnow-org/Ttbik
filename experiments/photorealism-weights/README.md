# Photorealistic human-generation weight matrix

This directory is an evaluation plan, not a production routing change.

## Selection rules

- Every image-generation checkpoint is a distinct weight set with its own immutable source, manifest, private ModelScope model repository, and dedicated Studio endpoint.
- Never point multiple candidate image generators at the same checkpoint directory or ModelScope model repository.
- Do not replace a language model's own weights with a Stable Diffusion checkpoint. SD checkpoints are separate image generators; native multimodal generators keep their own architecture and weights.
- Select models trained/tuned for photographic human subjects. Exclude anime, Pony, Illustrious, cartoon, illustration, and style-transfer checkpoints from this human-photography track.
- Verify source, exact file/version, license, file size, and SHA-256 before uploading. Do not upload a model whose license is unknown.
- Run one Studio generation workload at a time on the free 2-vCPU / 8-GB CPU tier. Do not deploy SDXL on that tier; require a separately verified GPU tier first.
- No candidate weights are merged together. No production route changes until the same benchmark is reviewed.

## Candidate matrix

| ID | Exact checkpoint | Architecture | Photographic use | Package / resource notes | Decision |
|---|---|---|---|---|---|
| RV6 | `SG161222/Realistic_Vision_V6.0_B1_noVAE` | SD 1.5 | Baseline photoreal human portraits and scenes | 2.13-GB FP16 checkpoint + separately verified MSE VAE; already staged in `novaai2026/realistic-vision-v6-test-models` | **Assigned to Gemma 4 E4B** — previous generation success; do not repeat the generation test |
| CYBER-FINAL | `cyberdelia/CyberRealistic` → `CyberRealistic_FINAL_FP16.safetensors` | SD 1.5 | Author-described photorealistic human portraits/scenes; baked VAE | About 1.99 GiB FP16; no second VAE should be silently substituted. Author documents DPM++ SDE Karras / DPM++ 2M Karras, 30 steps, CFG 5, 512×768 | **Assigned to Qwen3.5-9B** — previous generation success; exact checkpoint hash pinned; do not repeat the generation test |
| UMRANZ | `Umranz/SD1.5-Uncensored-Photoreal` | SD 1.5 | Photorealistic people and scenes | Staged in `novaai2026/umranz-sd15-test-models`; prior Studio launch failed before a verified sample was produced | **Assigned to MiniCPM-o 4.5** — repair/restart the Studio and retest; not yet counted as successful |
| EPIC | `emilianJR/epiCRealism` | SD 1.5 Diffusers | Natural-light / RAW-photo portrait and lifestyle examples | OpenRAIL-M; Diffusers pipeline; approx. 0.9B parameters. UNet safetensors is about 3.44 GB, plus text encoder and VAE; test memory use before deployment | Unassigned reserve for phase 2; earlier download/deployment issue must be fixed before testing |
| REALVISXL | `SG161222/RealVisXL_V5.0` | SDXL | Clean, natural photoreal portraits and scenes; higher native detail | FP16 single checkpoint about 6.94 GB; OpenRAIL++; SDXL. Dedicated GPU required; do not try on the free 8-GB CPU Studio | High-resolution tier, pending GPU hardware confirmation |
| JUGGERNAUT-R | `Kandoo/Juggernaut-XL-Ragnarok` | SDXL | Versatile photoreal people, portraits and cinematic scenes | Official creator upload; 7.1-GB FP16 or 4.54-GB FP8 file; OpenRAIL-M; creator showcase uses 896×1152, 30 steps, CFG 5 for portraits | Optional SDXL comparator after hardware confirmation |

## Exclusions

- `digiplay/majicMIX_realistic_v7`: attractive distinct SD 1.5 candidate, but its Hub metadata currently says `license: other`, not a clear license. Do not stage until the original license terms are established.
- Pony, Illustrious, AnimeMix, MeinaMix, ReV Animated and other explicitly anime/cartoon/style checkpoints: outside this human-photography evaluation.
- Random mirrors or repackaged checkpoints: use creator/official repositories and verify hashes.

## Controlled benchmark

Each checkpoint is evaluated separately with its own recommended sampler/CFG, but the same prompt suite and fixed seeds. Save the raw output, model id, exact file hash, sampler, steps, CFG, seed, resolution, generation duration, and any post-processing.

1. Close-up documentary portrait: visible natural pores, fine lines, realistic eyes, natural asymmetry, unretouched skin.
2. Half-body candid photograph: natural clothing folds, realistic hair, shoulders and hands visible.
3. Full-body street photograph: anatomically plausible limbs, feet and ground contact, natural daylight.
4. Hands interacting with an object: both hands fully visible, holding a ceramic cup; inspect finger count and joints.
5. Two-person photograph: distinct faces, correct body proportions, natural interaction and no duplicated features.
6. Indoor low-light portrait: realistic skin tones, mixed lighting, no wax/plastic skin or synthetic-looking eyes.

## Scoring (0–5 per category)

- Human likeness / face realism
- Eye, skin, hair and fine detail
- Hand and body anatomy
- Natural lighting, shadows and color
- Prompt adherence and scene consistency
- Absence of cartoon / CGI / illustration appearance
- Stability across at least three seeds

A checkpoint is not accepted from one attractive sample. Require at least three seeds per prompt group, inspect all outputs, and record failure cases. Upscaling is scored separately from native generation so it cannot hide a weak checkpoint.

## Source cards

- [Realistic Vision V6.0](https://huggingface.co/SG161222/Realistic_Vision_V6.0_B1_noVAE)
- [CyberRealistic by Cyberdelia](https://huggingface.co/cyberdelia/CyberRealistic)
- [Cyberdelia's official CyberRealistic notes and file hashes](https://cyberdelia.nl/models/cyberrealistic-sd-1-5)
- [epiCRealism](https://huggingface.co/emilianJR/epiCRealism)
- [RealVisXL V5.0](https://huggingface.co/SG161222/RealVisXL_V5.0)
- [Juggernaut XL Ragnarok — creator upload](https://huggingface.co/Kandoo/Juggernaut-XL-Ragnarok)

## Current status

- **Qwen3.5-9B → CyberRealistic FINAL** (previous generation success; keep its saved sample and do not repeat the test).
- **Gemma 4 E4B → Realistic Vision V6** (previous generation success; keep its saved samples and do not repeat the test).
- **MiniCPM-o 4.5 → Umranz** (assigned as the next test; Studio must be repaired/restarted before generation can be judged).
- epiCRealism remains unassigned for phase 2; Juggernaut XL Ragnarok and RealVisXL remain unassigned until a dedicated GPU tier is verified.
- Nova and Sham v2 have **no new donor-weight assignment during this phase**. They are considered only after the three candidates have been evaluated and any remaining successful weights are known.
