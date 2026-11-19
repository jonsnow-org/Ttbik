# Sham 2 ModelScope account and Studio routing

This file is the source of truth for the Sham 2 unified path. CN and international ModelScope accounts are strictly separate. Never substitute one token, endpoint, Studio, or runner for another.

## CN account — Sham 2 only

| Setting | Exact value |
|---|---|
| Account | novaai2026 |
| Credential | GitHub secret MODELSCOPE_TOKEN, injected into the dedicated workflow as T_CN |
| Hub/API | www.modelscope.cn |
| Studio inference host | studio-novaai2026-sham2-tldm.api-inference.modelscope.net |
| Training Studio | novaai2026/sham2-tldm — dedicated Sham 2 training only |
| Donor repository | novaai2026/sham-v2 — read-only |
| Donor checkpoint | final_merged.pt |
| Donor tokenizer | sham_small_tokenizer.json |
| Serving Studio | novaai2026/sham-v2-server — separate serving resource |
| Legacy head repository | novaai2026/sham2-tldm-head — never overwrite with the unified v2 candidate |

## International AI account — Sham 1 only

| Setting | Exact value |
|---|---|
| Account | Jonjithup |
| Credential | GitHub secret MODELSCOPE_AI_TOKEN, injected as T_AI |
| Hub/API | www.modelscope.ai |
| Studios | sham-trainer-1, sham-trainer-2, sham-trainer-tools — Sham 1 only |
| Generic runner | sham-runner-1 — not a Sham 2 runner and must never be selected for this job |

No workflow in the unified Sham 2 path reads MODELSCOPE_AI_TOKEN, T_AI, or calls the international Hub. Do not modify the three Sham 1 studios, their weights, or their repositories. Do not use sham-runner-1.

## Dispatch contract inside the dedicated Studio

ai-system/modelscope-trainer/app.py::_resolve_run_fn() retains the existing dispatch rule:

- SHAM_TRAINER_JOB=tldm and SHAM_TRAINER_NAME beginning with sham2 selects run_sham2().
- A different T-LDM name follows the independent Nova/legacy route. It is not Sham 2.
- In Sham 2 mode, run_sham2() now invokes tldm/sham_tldm/sham2_unified.py. It does not invoke training/train_sham2.py, the old configs/sham2.yaml, or the historical 2026-11-18 gate.
- Sham 2 runs once and fails closed; it does not automatically retry an interrupted or failed training cycle.
- The cross-Studio guard thread is disabled only in the isolated Sham 2 mode. The dedicated Studio therefore cannot wake or supervise Sham 1 Studios or the generic runner.
- The app exposes a read-only sham2_report endpoint for retrieving the per-run donor, training, gate, and head manifests.

The unified run is stored under a fresh per-run directory:

TLDM_WORK/sham2-unified/runs/<SHAM2_UNIFIED_RUN_ID>/

The new head is written only to:

.../training/sham2_heads.pt

The legacy TLDM_WORK/sham2/sham2_heads.pt, donor repository, and legacy head repository are not written by this path.

## Required execution sequence

The dedicated workflow .github/workflows/sham2-unified-studio.yml is restricted to:

- account novaai2026;
- host www.modelscope.cn;
- Studio novaai2026/sham2-tldm;
- credential MODELSCOPE_TOKEN -> T_CN.

It stages the PR's app.py, sham_small/, and T-LDM source into that Studio only. It explicitly omits training/train_sham2.py, configs/sham2.yaml, and the historical 2026-11-18 gate file. The current workflow is deliberately **preflight-only**. It runs --check-donor inside that Studio and captures the complete tensor key/shape/dtype inventory, installed ModelScope version and actual snapshot_download signature, plus the donor SHA-256. A code/signature TypeError or ValueError fails immediately; only transient network/HTTP errors are retried, with at most three SDK download attempts. The polling step exits as soon as the Studio reports donor-check-failed and never waits through 360 repeated polls.

No training or gate is started by the donor-preflight workflow. A separate, explicit training action may be prepared only after the saved donor report states compatible and the owner has reviewed its installed SDK signature and SHA-256. That later action must use:

--stage available --batch-size 1

The trainer must use a frozen BF16 donor and rank-16 LoRA plus the new T-LDM head. The admitted data must remain exactly identity 16 + terminal 30 = 46 training records, with 26 held-out examples. The report and manifest must state partial, not full, with tools: missing and arabic: missing; no generated or remote records are admitted. The fresh terminal gate must evaluate only the new head, compare both donor and head SHA-256 values to the preflight, and never read the old gate.

## Memory and runner guard

The audited dedicated Studio is platform/2v-cpu-8g-mem (2 vCPU / 8 GB). The preflight runs there first as requested. Before loading the donor for partial training, the app checks MemAvailable; it refuses training if less than 4.5 GiB is free. It does not force a run in insufficient memory. If this guard blocks, a separate free CN-only Sham 2 runner may be evaluated; no Sham 1 studio or sham-runner-1 is an acceptable substitute. Any such runner must be documented and separately scoped to the CN Sham 2 account.

## Verified implementation status

- The original audit workflow 44486966687 verified the two-account mapping and the dedicated Studio inventory. The audited Studio was novaai2026/sham2-tldm, Running, 2 vCPU / 8 GB.
- PR #1136 contains the isolated run_sham2() replacement, the unified trainer and gate path fixes, and this routing document.
- The dedicated workflow has successfully passed its source/data validation, staged the PR trainer into novaai2026/sham2-tldm, set CN-only Studio secrets, and sent the donor-check deployment request.
- The donor compatibility check is a separate live gate. Until its full report says compatible, no partial training may start. No training loss, candidate-gate score, or new-head hash is claimed by this document.
- PR #1136 remains draft and unmerged until the donor check, partial training, fresh gate, exact data manifest, and untouched Sham 1 conditions are all evidenced by the dedicated workflow artifacts.

References:
- https://github.com/jonsnow-org/Ttbik/pull/1136
- https://github.com/jonsnow-org/Ttbik/blob/fix/sham2-unified-real-donor-data/.github/workflows/sham2-unified-studio.yml
