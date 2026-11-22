# Supervisor review — Nova 1 / Nova 2 on Sham 2's technique (2026-11-18)

Reviewer: main Claude session, acting as supervisor for the site/tools/bots work (owner's standing order 2026-10-20).
Scope reviewed: the Nova T-LDM work and the per-model T-LDM policy refactor on `claude/free-services-marketplace-h6rwk2`.

## Verdict

Accepted, with one limit stated plainly (below). Independence — the owner's hard condition — holds in code, in the
trainer, and in tests. Nothing in `athar/**`, `cloudflare/**`, `deploy/oracle/**` or the live contracts was touched.

## What was reviewed

1. `src/lib/tldmPolicy.ts` — rewritten so the audience switch and the owner deny-list are keyed per model
   (`tldm_open:<model>` / `tldm_deny:<model>`, env `SHAM_` / `NOVA1_` / `NOVA2_TLDM_OPEN`). Default stays owner-only for
   every model; an unknown model inherits nothing. Every call site passes its model explicitly.
2. `src/lib/novaTldm.ts` — Nova's own T-LDM client. Imports nothing from Sham. No default model: without an explicit
   `withNovaTldmModel` scope it refuses rather than guessing. Failures return an honest, model-named error
   (`reason: "no-fallback"`), never a silent switch to the other Nova, to Sham, or to plain chat.
3. `ai-system/modelscope-trainer/app.py` — `nova_mode` / `run_nova` / `nova_donor` / `nova_run_key`. One code path, but
   a separate donor, config, work folder, head file, head repo and recipe key per Nova. An ambiguous job name is refused.
   Nova's benchmark runs in the neutral test sandbox, never in Sham's embedded computer.
4. `ai-system/tldm/configs/nova1.yaml`, `nova2.yaml` — Sham 2's recipe (same trainer, same head, same gate) on each
   Nova's own body.
5. Tests: `src/lib/__tests__/novaTldm.test.ts` (11), `ai-system/modelscope-trainer/test_nova_tldm_job.py` (11), plus the
   updated `tldmPolicy`, `sham2Tldm`, `studioIsolation`, `novaShamBoundary` suites.

## Checks run

- `npx tsc --noEmit` — clean.
- `jest` (media config, full) — 225 suites / 1882 tests passed.
- `python3 -m unittest test_nova_tldm_job` — 11 passed.
- `python3 app.py --selftest` (trainer, incl. the new Nova isolation block) — OK.

## The limit the owner must know

Nova 1 and Nova 2 are served by llama.cpp (GGUF) and that process has **no `generate_tldm` endpoint** and no PyTorch body
to produce the frozen reader features. So a Nova head can be **trained and published** today, but not yet **served**.
`novaGenerateTldm` therefore returns an honest error when the path is not ready. This matches the owner's own rule for
Sham 2 (no silent fallback, a clear error). Serving needs one further piece — a PyTorch head server per Nova — which is
a separate decision because of its memory cost on a free CPU box. This is recorded in `docs/coder/NOVA_TLDM.md`.

## Notes for the next session

- Sham 2's behaviour is unchanged: its path still passes `"sham_v2"` and its gate is the same.
- The device mesh (not per model) refuses the union of every model's deny-list — deliberate, since a command blocked for
  one model must not become allowed by switching models.
