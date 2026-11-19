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
| Jonjithup/sham-trainer-1 | AI Studio | Sham 1 trainer lane |
| Jonjithup/sham-trainer-2 | AI Studio | Sham 1 trainer lane |
| Jonjithup/sham-trainer-tools | AI Studio | Sham 1 tools trainer lane |
| Jonjithup/sham-runner-1 | AI Studio | Generic GitHub Actions self-hosted runner (studio label), not Sham 2 training |
| Jonjithup/coder-inference-server-16 | AI Studio | Nova 2 serving/chat; not Sham 2 |

The generic studio runner label belongs to Jonjithup/sham-runner-1. It is not the Studio novaai2026/sham2-tldm. A job scheduled on runs-on: [self-hosted, studio] therefore does not become a Sham 2 Studio job merely because its label says studio.

## 3. How the engineers' working account routing is implemented

1. .github/workflows/keep-trainer-studios-awake.yml maps secrets.MODELSCOPE_TOKEN to T_CN and secrets.MODELSCOPE_AI_TOKEN to T_AI. It calls studio_guard.py --once.
2. ai-system/modelscope-trainer/studio_guard.py has separate HOSTS and APP_DOMAIN maps for cn and ai; token_for(site) selects the matching token, and every OpenAPI request uses Authorization: Bearer with the site-specific token.
3. The same guard's Studio registry includes the dedicated CN sham2-tldm training Studio and separately lists AI Sham 1 trainers and the AI generic runner.
4. The successful keep-awake execution 44462059243 (19 November 2026) reported all 12 registered Studios as Running, including cn/novaai2026/sham2-tldm, the AI Sham 1 trainers, and the AI generic runner. This confirms the prior engineers' cross-account watcher path and is the reference execution for the token aliases.
5. .github/workflows/deploy-sham-trainer-studio.yml is a generic Sham live-trainer deployment using ai-system/modelscope-trainer/app.py and the sham_live code path. Its optional job=tldm means that generic T-LDM writer experiment inside that app; it does not mean the unified Sham 2 trainer in this PR.
6. .github/workflows/deploy-studio-runner.yml is explicitly AI-only (Jonjithup, MODELSCOPE_AI_TOKEN) and installs the generic GitHub runner. It is not a Sham 2 training deployment.
7. .github/workflows/sham-v2-ask.yml targets sham-v2-server as a serving endpoint; it is not a training path.

## 4. Required isolation for Sham 2

- Training Studio: use only the audited novaai2026/sham2-tldm Studio on the CN account.
- Donor: download only final_merged.pt and sham_small_tokenizer.json from the separate novaai2026/sham-v2 model repository with the CN credential and CN Hub endpoint.
- Head output: save the new Sham 2 v2 head in its own run/output artifact. Never write to the donor repository or the legacy sham2-tldm-head repository.
- No Sham 1 paths: do not use ai-system/modelscope-trainer/app.py, its MiniLM donor, writer_donor.yaml, sham_live, the AI Sham 1 trainer Studios, or the generic AI runner for unified Sham 2 training.
- No token fallback across sites: T_CN must never be used on modelscope.ai; T_AI must never be used on modelscope.cn.
- No training until route verification: the dedicated Studio status and source inventory must be verified before any Stage 1 --check-donor, training, or fresh gate is launched on that Studio.

## 5. Current guardrail

The Stage 1 workflow in this PR is intentionally disabled while its former self-hosted, studio runner association is removed. The read-only dual-account audit is separate. Do not enable training until its dedicated target is proven to be novaai2026/sham2-tldm and its own runtime can run the Sham 2 code.
