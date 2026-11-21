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

## Independence guarantees (enforced in code and tests)

- `src/lib/novaTldm.ts` imports nothing from Sham; `novaShamBoundary` guards it.
- The per-model T-LDM switch and deny-list live in `tldmPolicy.ts`, keyed `tldm_open:<model>` / `tldm_deny:<model>`;
  opening one model never opens another, and an unknown model inherits nothing (`tldmPolicy.test.ts`).
- The Studio pool is chosen by the engine model in scope (`withEngineModel`), so a Nova 1 call cannot reach Nova 2's
  Studio and vice versa (`studioIsolation.test.ts`).
- Work folders, head files and head repos are separate per model, and the trainer refuses to guess (`app.py --selftest`).
