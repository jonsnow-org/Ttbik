# Nova 1 / Nova 2 on T-LDM — Sham 2's technique, each on its own

Owner's order (2026-11-18): «طبق الخطوات كلها أيضًا لنوفا1، الشرط هو الاستقلالية». This document says exactly
what was transferred, what each model owns, and — honestly — what is **not** yet possible on a free CPU.

## What "Sham 2's technique" actually is

Sham 2's advance over Sham 1 is a **T-LDM head** on a frozen body: a small trainable head (Compressor + Latent
Thinker + Diffusion Writer) sits on top of a frozen pretrained body, and only the head trains. The body is read once
per text (`--cached`), so training fits a CPU. Three more pieces come with it:

1. a **guarded merge gate** — a head whose held-out score is at the floor is never published (`HELDOUT_PUBLISH_FLOOR`);
2. an **experience / lessons layer** (`evolution/api.py`) — verified successes become training pairs, per `model_id`;
3. a **regression guard** (`sham_guard.py`) — publish the best weights found, roll back when a skill drifts.

## What is now true for Nova 1 and Nova 2

| Piece | Sham 2 | Nova 1 (`coder`) | Nova 2 (`nova2`) |
|---|---|---|---|
| T-LDM head recipe + config | `configs/sham2.yaml` | `configs/nova1.yaml` | `configs/nova2.yaml` |
| Trainer job | `run_sham2`, name `sham2*` | `run_nova`, name `nova1*` | `run_nova`, name `nova2*` |
| Work folder | `tldm_work/sham2` | `tldm_work/nova1` | `tldm_work/nova2` |
| Head file | `sham2_heads.pt` | `nova1_heads.pt` | `nova2_heads.pt` |
| Head repo | `sham2-tldm-head` | `nova1-tldm-head` | `nova2-tldm-head` |
| Donor body (read-only copy) | `novaai2026/sham-v2` | `Qwen/Qwen3.5-4B` | `Qwen/Qwen3.6-35B-A3B` |
| Benchmark terminal | Sham's embedded computer | neutral test sandbox | neutral test sandbox |
| Audience switch | `SHAM_TLDM_OPEN` / `tldm_open:sham_v2` | `NOVA1_TLDM_OPEN` / `tldm_open:coder` | `NOVA2_TLDM_OPEN` / `tldm_open:nova2` |
| Owner deny-list | `tldm_deny:sham_v2` | `tldm_deny:coder` | `tldm_deny:nova2` |
| Workspace session | `tldm-sham_v2-<chat>` | `tldm-coder-<chat>` | `tldm-nova2-<chat>` |
| Serve path | `shamStudio.shamGenerateTldm` | `novaTldm.novaGenerateTldm` | `novaTldm.novaGenerateTldm` |

The trainer's self-test (`python app.py --selftest`) proves the isolation: each Nova fetches **its own** donor, trains
with **its own** config, writes **its own** head file in **its own** folder, and publishes to **its own** repo; an
ambiguous job name is refused rather than guessed; the two recipe keys differ, so changing one config never
invalidates the other's cached result.

## The honest limit (must not be hidden from the owner)

Sham 2 is served by a **PyTorch** Studio (`modelscope-sham`) that holds the body in memory and can run a `generate_tldm`
endpoint. Nova 1 and Nova 2 are served by **llama.cpp** (`modelscope-coder`, GGUF): there is no PyTorch body in that
process, so it cannot produce the frozen reader features the head needs, and it has **no `generate_tldm` endpoint**.
Therefore:

- **Training** a Nova head works today: it runs in the trainer Studio (PyTorch), downloads a read-only copy of the
  donor body, and publishes `nova1_heads.pt` / `nova2_heads.pt`.
- **Serving** it needs one more piece that does not exist yet: either a `generate_tldm` endpoint inside the coder
  Studio that loads the same body in PyTorch (memory-heavy on a free CPU box), or a small separate PyTorch head server
  per Nova that the bot calls. Until that exists, `novaGenerateTldm` returns an **honest error** naming the model and
  stating that nothing else was used — never a silent fallback to the other Nova, to Sham, or to the plain chat model.

This is the same standard the owner set for Sham 2: no silent fallback, a clear error when the path is not ready.

## A serving route that was measured (2026-11-21): the GGUF itself is the frozen reader

`llama-server` started with `--embeddings --pooling none` returns one unnormalised final-layer vector per input token
(documented `/embeddings` format), so the quantised GGUF that Nova already serves can feed the head without any PyTorch body.
`sham_tldm/llama_reader.py` is that reader, `training/train_gguf_head.py` trains and scores a head on its features with Sham 2's
recipe, and `.github/workflows/tldm-nova-gguf-head.yml` runs it on a GitHub runner (no secret, no Studio touched).

Measured on Nova 1's own file (`unsloth/Qwen3.5-4B-GGUF`, Q4_K_M; 4 vCPU runner; run 44904324347):

| | result |
|---|---|
| feature width | 2560 (token ids go in directly: `input mode: tokens`) |
| reading the 368 training texts | 106 s in total (about 0.29 s per text) |
| head (4.5M parameters), 3 seeds, 600 steps | train 1.0 / 1.0 / 1.0 |
| held-out (12 tasks, never trained on) | 0.75 / 0.917 / 0.917, mean 0.861 |
| held-out 2 (14 tasks, never trained on) | 0.643 / 0.714 / 0.571, mean 0.643 |
| 95% Wilson verdict against the 0.6 gate | held-out: inconclusive / pass / pass; held-out 2: inconclusive on every seed |

Same order as the other readers (Sham Pro on its own frozen body: 0.805 / 0.619; the MiniLM reader: 0.778 / 0.81). With 12 and 14 tasks,
one task is 7-8 points, so none of these is a clean pass or fail against 0.6.

What is still true and not measured:
- A server in embedding mode does not generate text, so serving needs a **second** `llama-server` on the same GGUF next to the chat one (the file is
  memory-mapped, so the weights are shared; each process still pays its own compute buffers). That fits Nova 1 (a 2.7 GB file on 8 GB) in principle; it was
  not tried on a Studio. It does **not** fit Nova 2 (a ~12 GB file on a 16 GB box), so Nova 2 stays training-only.
- The head must be trained on these GGUF features, not on the PyTorch body's: a Q4 file's numbers differ from the full-precision body's.
- Nothing here is deployed; `novaGenerateTldm` still returns its honest error until a Studio runs the second server and the head.

## Independence guarantees (enforced in code and tests)

- `src/lib/novaTldm.ts` imports nothing from Sham; `novaShamBoundary` guards it.
- The per-model T-LDM switch and deny-list live in `tldmPolicy.ts`, keyed `tldm_open:<model>` / `tldm_deny:<model>`;
  opening one model never opens another, and an unknown model inherits nothing (`tldmPolicy.test.ts`).
- The Studio pool is chosen by the engine model in scope (`withEngineModel`), so a Nova 1 call cannot reach Nova 2's
  Studio and vice versa (`studioIsolation.test.ts`).
- Work folders, head files and head repos are separate per model, and the trainer refuses to guess (`app.py --selftest`).

## ملحق 2026-11-22: ما تغيّر عن الأعلى
- نوفا نموذج واحد (`coder`، جسمه Qwen3.6-35B)؛ `nova2` اسم قديم فقط.
- **توجد الآن** نقطة `generate_tldm` في `modelscope-coder/app.py` و`nova_tldm_serve.py` (خادم قراءة ثانٍ على الملف نفسه عبر mmap + رأس كاتب)، مطفأة ما لم يُضبط `NOVA_TLDM=1`. الرأس يعود بـ`text` أو `tool_request` (يُنفَّذ في التطبيق بتأكيدات نوفا) أو `body` (يجيب جسم نوفا نفسه).
- رأس نوفا على جسمها (35B، عرض الميزات 2048): heldout 0.861 وheldout2 0.738 (بوابة 0.6)، حكم Wilson «غير حاسم» لصغر المجموعتين. Writer فقط، لا حلقة متعددة الخطوات.
- التفصيل والبنود المؤجلة: [`REVIEW_1198_RESPONSE.md`](./REVIEW_1198_RESPONSE.md).
