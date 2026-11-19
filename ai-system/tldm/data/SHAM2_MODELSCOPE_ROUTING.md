# Sham 2 ModelScope account and Studio routing (do not mix with Sham 1)

This is the source-of-truth routing note for Sham 2 Stage 1. A ModelScope account, a Studio, a model repository, and a serving endpoint are different resources. Do not use one as a substitute for another.

## 1. CN account — Sham 2's dedicated training Studio and donor repository

| Item | Exact route | Role |
|---|---|---|
| Account owner | novaai2026 | CN ModelScope account |
| Hub/API host | www.modelscope.cn | CN ModelScope |
| Inference host suffix | api-inference.modelscope.net | CN Studio apps |
| GitHub secret | MODELSCOPE_TOKEN | CN credential only |
| Existing workflow variable | T_CN | Alias for MODELSCOPE_TOKEN |
| Dedicated Sham 2 training Studio | novaai2026/sham2-tldm | T-LDM training Studio; registered as policy train in studio_guard.py |
| Donor model repository | novaai2026/sham-v2 | Read-only donor checkpoint + tokenizer; not a Studio |
| Donor checkpoint file | final_merged.pt | Frozen 4.15-GB donor checkpoint |
| Donor tokenizer file | sham_small_tokenizer.json | Donor tokenizer |
| Serving Studio | novaai2026/sham-v2-server | Sham v2 serving; not the Stage 1 training Studio |
| Legacy head repository | novaai2026/sham2-tldm-head | Legacy head only; do not use as the new candidate or overwrite |

The sham2-tldm training Studio is explicitly listed in ai-system/modelscope-trainer/studio_guard.py as ("cn", "novaai2026", "sham2-tldm", "train"). Its separate donor repo is novaai2026/sham-v2.

## 2. International AI account — separate Sham 1 training lanes and generic runner

| Item | Exact route | Role |
|---|---|---|
| Account owner | Jonjithup | International ModelScope account |
| Hub/API host | www.modelscope.ai | International ModelScope |
| Inference host suffix | api-inference.modelscope.ai | International Studio apps |
| GitHub secret | MODELSCOPE_AI_TOKEN | International credential only |
| Existing workflow variable | T_AI | Alias for MODELSCOPE_AI_TOKEN |
| Jonjithup/sham-trainer-1 | AI Studio, 16-GB CPU | Sham 1 trainer lane |
| Jonjithup/sham-trainer-2 | AI Studio, 16-GB CPU | Sham 1 trainer lane |
| Jonjithup/sham-trainer-tools | AI Studio, 16-GB CPU | Sham 1 tools trainer lane |
| Jonjithup/sham-runner-1 | AI Studio, 16-GB CPU | Generic GitHub Actions self-hosted runner (studio label), not Sham 2 training |
| Jonjithup/coder-inference-server-16 | AI Studio, 16-GB CPU | Nova 2 serving/chat; not Sham 2 |

The generic studio runner label belongs to Jonjithup/sham-runner-1. It is not the Studio novaai2026/sham2-tldm. A job scheduled on runs-on: [self-hosted, studio] therefore does not become a Sham 2 Studio job merely because its label says studio.

## 3. How the engineers' existing Sham 2 training path actually works

The dedicated CN Studio repository was cloned read-only during audit run 44486966687. Its ModelScope Git revision was fa1ef3e3065816b8e5181ac13503c1f3f3f93ebe. It contains app.py, a sham_small/ tree, and the staged tldm/ tree.

The app.py file is a shared trainer host, but it contains a distinct Sham 2 branch. This is important: the physical app wrapper is shared with trainer infrastructure; the selected execution function is not the Sham 1 live-trainer path.

1. Settings select the Sham 2 branch only when SHAM_TRAINER_JOB=tldm and SHAM_TRAINER_NAME begins with sham2.
2. _resolve_run_fn() then selects run_sham2(), not run_tldm() or sham_live.run().
3. run_sham2() uses an isolated work path under TLDM_WORK/sham2, downloads a copy of the donor repo novaai2026/sham-v2, and leaves the donor repository read-only.
4. sham2_hub_check() explicitly rejects the international AI site/account for this donor. It requires the CN host and CN token.
5. The existing branch invokes ai-system/tldm/training/train_sham2.py with configs/sham2.yaml, BF16, cached donor features, 3 writer seeds, one loop seed, identity, and the historical gate file.
6. It publishes only sham2_heads.pt and sham2_results.json to the separate repository novaai2026/sham2-tldm-head. It does not publish the donor checkpoint to that repository.
7. The serving Studio novaai2026/sham-v2-server is a separate Studio and consumes the head from sham2-tldm-head only when its own T-LDM serving switch is enabled.

**Crucial distinction for this PR:** the existing sham2-tldm Studio branch is a real Sham 2-specific route, but it currently calls the legacy training/train_sham2.py path and the 2026-11-18 gate. This PR's new unified trainer is ai-system/tldm/sham_tldm/sham2_unified.py with its own data manifest, --check-donor, partial stage admission, and new gate. The unified trainer has NOT yet been staged into or executed by the dedicated Studio. Do not mistake the historical run_sham2 branch or its historical gate as results for the unified PR trainer.

## 4. Required isolation for Sham 2

- Training Studio: use only the audited novaai2026/sham2-tldm Studio on the CN account.
- Donor: download only final_merged.pt and sham_small_tokenizer.json from the separate novaai2026/sham-v2 model repository with the CN credential and CN Hub endpoint.
- Head output: save the new Sham 2 v2 head in its own run/output artifact. Never write to the donor repository or the legacy sham2-tldm-head repository.
- No Sham 1 paths: do not use ai-system/modelscope-trainer/app.py, its MiniLM donor, writer_donor.yaml, sham_live, the AI Sham 1 trainer Studios, or the generic AI runner for unified Sham 2 training.
- No token fallback across sites: T_CN must never be used on modelscope.ai; T_AI must never be used on modelscope.cn.
- No training until route verification: the dedicated Studio status and source inventory must be verified before any Stage 1 --check-donor, training, or fresh gate is launched on that Studio.

## 5. Current guardrail

The Stage 1 workflow in this PR is intentionally disabled while its former self-hosted, studio runner association is removed. The read-only dual-account audit is separate. Do not enable training until its dedicated target is proven to be novaai2026/sham2-tldm and its own runtime can run the Sham 2 code.


## 6. Actual application found inside the dedicated CN Sham 2 Studio

The read-only clone of \`novaai2026/sham2-tldm\` (Studio commit \`fa1ef3e3065816b8e5181ac13503c1f3f3f93ebe\`) contains the previous engineers' \`app.py\` and its own T-LDM tree. The app is the shared \`ai-system/modelscope-trainer/app.py\`, but its dispatch has an explicit Sham 2 branch:

- \`settings()\` reads \`SHAM_TRAINER_NAME\` and \`SHAM_TRAINER_JOB\`.
- \`_resolve_run_fn()\` routes \`job=tldm\` and a name beginning \`sham2\` to \`run_sham2()\`.
- \`job=tldm\` with a different name such as \`ms1\` goes to \`run_tldm()\`, the **Sham 1-style generic T-LDM writer**. That path uses \`sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2\` and \`writer_donor.yaml\`.
- The Sham 2 path \`run_sham2()\` enforces the CN host and owner, downloads a read-only copy of \`novaai2026/sham-v2\`, then currently invokes the **legacy** \`training/train_sham2.py --config configs/sham2.yaml --cached --dtype bf16 --seeds 3 --loop --identity\`. It writes \`sham2_heads.pt\` and \`sham2_results.json\` locally and publishes them to \`novaai2026/sham2-tldm-head\`, never to the donor repo.
- Its \`sham2_gate()\` reads the old \`tldm_heldout_gate_2026-11-18.json\` when that file is present. Therefore this legacy branch is **not** the new Stage 1 unified trainer and must not be started for the current task; it would execute the old training implementation and old gate.

The existing generic deploy workflow can provision this Studio using the two-account mapping, with the historical Sham 2 settings \`site=cn\`, \`repo=sham2-tldm\`, \`name=sham2\`, \`job=tldm\`. This explains how the Studio is provisioned and why its own app recognizes Sham 2. It does **not** authorize reusing its old \`run_sham2()\` for the unified Stage 1 run.

## 7. Serving is a third, separate path

- \`novaai2026/sham-v2\` is the donor model repo, not the training Studio.
- \`novaai2026/sham2-tldm\` is the dedicated Sham 2 training Studio.
- \`novaai2026/sham-v2-server\` (and \`sham-v2-overflow-server\`) are serving Studios. The serving wrapper sets \`SHAM_TLDM=0\` until a compatible head is published and explicitly avoids a Sham 1 fallback.
- \`novaai2026/sham2-tldm-head\` is the legacy output model repo for the old trainer. Do not overwrite it with the new unified-heads-v2 artifact.

## 8. Correct next implementation boundary

The new unified Stage 1 runner must be added as an explicitly named Sham 2-only action inside \`novaai2026/sham2-tldm\` (or a dedicated worker launched by that Studio), with an explicit CN-only guard. It must call the PR's \`sham2_unified.py\` \`--check-donor\` first, then \`--stage available\`, then the new partial gate; it must not call \`run_sham2()\`, \`training/train_sham2.py\`, \`run_tldm()\`, or read the 18-Nov writer-donor gate. It must publish a versioned v2 head to a new isolated output location, leaving both \`novaai2026/sham-v2\` and the legacy \`novaai2026/sham2-tldm-head\` unchanged.

The audited Studio is currently the CN free CPU tier \`platform/2v-cpu-8g-mem\`. That is not the AI account's 16-GB \`sham-runner-1\`; memory and donor-load feasibility must be measured on the CN Sham 2 Studio before training. The 16-GB AI Studios and runner must not be substituted because the donor and Studio secrets belong to the CN account.
