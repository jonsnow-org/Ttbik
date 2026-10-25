# Nova 1 — coding model (phase 1: code only)

Nova 1 is a LoRA fine-tune of **Qwen/Qwen3.5-4B** (Apache-2.0) made to write, fix and test code better, and to drive the coder
bot's tools. Phase 1 is code only: code instructions, repair/debugging, agentic coding with tool calls, and tests. Arabic is used
only for the wording of coding tasks and for explanations around code, never as general chat data. Broader phases come later.

## Data (phase 1)
Every source, its live-checked licence, status and share of the mix is in [`datasets.yaml`](datasets.yaml).

| share | what | sources |
|---|---|---|
| 54% | code instructions | bigcode/self-oss-instruct-sc2-exec-filter-50k (ODC-BY), nvidia/OpenCodeInstruct (CC-BY-4.0, test score ≥ 0.8), OpenCoder-LLM/opc-sft-stage2 educational+package (MIT), nvidia/Nemotron-Post-Training-Dataset-v1 code split (CC-BY-4.0, non-Llama generators only) |
| 12% | reasoning about code | nvidia/OpenCodeReasoning (CC-BY-4.0, DeepSeek-R1 traces) |
| 18% | repair / edits / debugging | bigcode/commitpackft (MIT, real commits) + our own execution-checked bug-fix rows (`scripts/make_repair_tasks.py`) |
| 12% | tool use / agentic coding | Salesforce/xlam-function-calling-60k (CC-BY-4.0), Nemotron tool_calling split (CC-BY-4.0), our own traces on SWE-Gym (MIT) / SWE-rebench (CC-BY-4.0) tasks in our tool format, kept only when the repo's tests pass |
| 4% | Arabic wording of code tasks | instructions above rewritten in Arabic by Qwen3.5 (Apache-2.0), code untouched (`scripts/translate_instructions.py`) |

Left out on purpose: anything non-commercial (NC), outputs of OpenAI or Anthropic models (their terms forbid training competing
models: Magicoder-OSS, CodeFeedback, SWE-smith trajectories), datasets with no stated generator, and Llama-3 outputs (the Llama
licence would force "Llama" into the model name). `scripts/check_licenses.py` re-reads every card and stops the build if a licence changed.

## Pipeline
```
pip install -r requirements.txt
python scripts/check_licenses.py                                   # 1. licences still as planned
python scripts/make_repair_tasks.py --n 20000                      # 2. our repair rows (run in a container)
python scripts/collect_traces.py --n 300                           # 3. our agent traces (Docker host, e.g. the Oracle runner; model over HTTP)
python scripts/build_mix.py --tokens 60000000                      # 4. mix -> data/mix.raw.jsonl
python scripts/translate_instructions.py data/mix.raw.jsonl data/ar_code.jsonl --n 15000 && python scripts/build_mix.py   # 5. Arabic wording, rebuild
python scripts/dedup_decontam.py data/mix.raw.jsonl data/mix.jsonl # 6. exact + MinHash dedup, 13-gram decontamination vs all evals
python scripts/known_filter.py score data/mix.jsonl --scores data/known.0.jsonl   # 7. (GPU) base-model loss of each row's answer
python scripts/known_filter.py select data/mix.jsonl --scores 'data/known.*.jsonl' --out data/mix.filtered.jsonl   #    drop rows it already knows
HF_TOKEN=... bash scripts/push_to_hub.sh <hf-user>/nova1-data      #    upload mix + code for the GPU notebook (free stage: build with --tokens 20000000 --max-len 2048)
python eval/run_eval.py --out reports/base.json                    # 7. baseline (base model served by llama-server)
python train/train.py --max-steps 30                               # 8. smoke run, then the full run
python train/train.py --resume
bash export/export_gguf.sh out/nova1-lora out/gguf                 # 9. merge -> GGUF f16 / Q4_K_M / Q8_0
python eval/run_eval.py --out reports/nova1.json                   # 10. ship only if no line is worse than base
python export/upload_modelscope.py out/gguf --repo novaai2026/nova1-4b-gguf
```

## Training settings (`train/config.yaml`)
bf16 LoRA r=32/α=32 on all attention + MLP projections, 4k context (8k on 24 GB), lr 1e-4 cosine, 2 epochs, effective batch 16,
loss on assistant turns only (tool outputs are never trained on), no packing so tool turns stay whole. 4-bit QLoRA is **not**
used: Unsloth's Qwen3.5 guide advises against it for this family. VRAM ≈ 10 GB → fits a free T4 (fp16 there). ~120M trained tokens
≈ 25–35 T4-hours or 8–10 L4/A10G-hours; checkpoints every 200 steps so free sessions can resume. At least 75% of rows keep the
reasoning style so the model's thinking mode survives.

## Evaluation (`eval/`)
HumanEval+ and MBPP+ (EvalPlus, pass@1 greedy), our 12 Arabic-worded coding tasks with tests (`eval/arabic_code_tasks.jsonl`,
built and self-checked by `eval/make_arabic_tasks.py`), and tool-call accuracy in our own tool format (`eval/tool_calls.jsonl`:
right tool, right arguments, no tool when none is needed). All eval prompts are removed from training by step 6.

## Serving as "Nova 1" in the coder
`export/studio/` is a Docker-type ModelScope Studio: it downloads `nova1-4b-q4_k_m.gguf` and serves it with llama.cpp's
OpenAI-compatible server (tool calls via `--jinja`) behind `NOVA1_API_KEY`. It is a **new** Studio; the existing Sham/vision Studio
is not touched. Then on Vercel set `NOVA1_STUDIO_URL` (+ `NOVA1_STUDIO_KEY`); the model picker (`src/lib/coderModels.ts`, entry
`nova1`) shows it as ready, and the owner flips it visible from the owner tools when the eval report is good.

## Free compute — no card, no ID (checked live 2026-10-21; Kaggle is kept for Sham)
| option | free GPU | limits | card? | ID / phone? | region | use |
|---|---|---|---|---|---|---|
| **AMD Radeon Cloud, China site** — [docs](https://amd-aim.github.io/radeon-cloud-docs/introduction/), [points](https://amd-aim.github.io/radeon-cloud-docs/guides/developer-program/), [CLI](https://amd-aim.github.io/radeon-cloud-docs/cli/instances/) | new AMD AI Developer Program members start with 100 points = 100 GPU-hours on a 48 GB Radeon (ROCm); more points for courses/events; up to 20 h exchanged per day; coupons valid 30 days, credits 90 days | official CLI `rcc` (PyPI `amd-oneclick-sdk`): create / SSH / delete, JSON output | not asked | email or GitHub login (phone optional); some accounts are reviewed | China-run service; check access from Türkiye at sign-up | **primary trainer**: `train/launch_radeon.sh` + `train/config.radeon.yaml` |
| CloudRift AI Grant — [page](https://www.cloudrift.ai/ai-grant) | $100–$1,000 credits on application (reviewed every 2 weeks) | console + API | not asked on the form | GitHub / project links | US company | second source, apply with the PR and HF repo |
| **Lightning AI free** — [pricing](https://lightning.ai/pricing), [SDK](https://pypi.org/project/lightning-sdk/) | 5 credits at sign-up ≈ 9 T4-hours (the other 25 need a card); one-time, expire in 12 months | official Python SDK / CLI: `Job.run(machine=Machine.T4, …)`, max runtime, cost per job | no | phone number (no ID) | blocked in Syria; Turkish number OK | reported down on 2026-10-21; keep `train/launch_lightning.py` for later |
| Google Colab (free) — [FAQ](https://research.google.com/colaboratory/faq.html) | T4 usually (not guaranteed) | ≤ 12 h per session; **no official API to start sessions** | no | Google account only | works from Türkiye; Google restricts Syria | manual fallback only: `train/nova1_colab.ipynb` |
| Cerebrium — [pricing](https://cerebrium.ai/pricing) | a "$10 free credit, no card" line was seen in search snippets, but it isn't on the live pricing page | CLI `cerebrium run` | — | — | — | unverified; check the balance after sign-up |
| Beam, Hyperbolic, TensorDock, SaladCloud, Thunder Compute | no free GPU credit now (Beam's $30/month withdrawn Sep 2026; Hyperbolic GPUs need a $5 deposit; Thunder's $20 is US students only) | — | yes / deposit | — | — | not usable |
| Novita | $100 credit for its Agent Sandbox (CPU only), not GPU instances | — | no | — | — | not for training |
| Hugging Face Jobs — [pricing](https://huggingface.co/docs/hub/jobs-pricing) | T4 $0.40/h | official CLI/API | needs a positive credit balance (paid) | — | — | not free |
| ModelScope Notebook | 36 h, 24 GB | — | no | Alibaba Cloud real-name (Chinese ID/phone) | — | not usable |
| Modal | $1/month without card | — | $30 needs card | — | — | not usable |
| Paperspace Gradient free | M4000 8 GB (too small for 4B bf16 LoRA) | 6 h | card on file | — | — | not usable |
| AMD Developer Cloud | $100 MI300X credit, 30 days | approval | payment method required | — | — | not usable |
| SageMaker Studio Lab | — | closed to new customers since 2026-07-30 | — | — | — | not usable |
| Hugging Face ZeroGPU | 5 min/day per free account | inference demos only | no | — | — | not for training |
| Intel Tiber AI Cloud | shared Gaudi2 / Max GPU notebooks | short shared sessions, not CUDA | no | email | US export rules | not with Unsloth; skip for now |
| Saturn Cloud, Deepnote | no free GPU | — | — | — | — | not usable |
| Google TRC (TPUs) | free TPUs on approval | needs a Google Cloud project with billing (card) | yes | — | — | not usable |
| Oracle Always Free / our runner | CPU only | always on | — | — | — | data work, not training (below) |

**Plan:** the CPU box does all data work; `train/launch_radeon.sh` (cron or by hand) checks the credit balance, creates one
Radeon instance with `rcc`, trains for MINUTES over SSH (resuming from the private HF checkpoint repo, checkpoint every 100 steps),
and deletes the instance so nothing burns idle. A 48 GB Radeon is roughly 2–3× a T4 for this job, so the full phase-1 run
(`config.radeon.yaml`, ~120M tokens) is an estimated 12–18 GPU-hours: well inside the 100 starting points, one or two daily exchanges at
the 20-hours-a-day exchange cap. CloudRift grant credits or a free Kaggle slot (when Sham allows) run the same command as a backup;
Lightning returns as a backup when it is back up. Throughput is measured in the first session (train.py logs tokens/s)
before committing the whole budget.

**Why not CPU training:** a LoRA step still runs the full 4B model forward and backward, ≈ 16 GFLOP per token. Oracle Always Free
Arm (2 OCPU / 12 GB for new tenancies; 4 cores on older ones) sustains maybe 30–60 GFLOPS in PyTorch → **about 1–4 tokens/s**, against
~1,000 tokens/s on a free T4. The 20M-token stage would take months on CPU (≈ 2–6 months), the full 120M tokens years, so CPU is
not a substitute. CPU is the right place for: licence checks, building the mix, dedup + decontamination, making and testing the
repair rows, collecting agent runs (Docker sandboxes; the model runs as a Q4 GGUF at ~5–10 tokens/s, so a few hundred runs take days in
the background), merging the adapter, GGUF conversion and quantising, and the evaluation runs.

## Later phases (not in this run)
Phase 2: longer agent traces from production (with consent) and preference tuning on passing vs failing fixes. Phase 3: broader
Arabic technical writing and docs. Each phase gets its own section in `datasets.yaml` and its own eval line.

## Kaggle run (owner decision 2026-10-21) — the plan in use

Phase 1 trains on the owner's Kaggle account, on the free weekly GPU quota (30 h, resets Saturday 00:00 UTC = 03:00 Türkiye time),
next to Sham's five notebooks.

| Piece | Where |
|---|---|
| Notebook | `kaggle/nova1_kaggle.ipynb` + `kaggle/kernel-metadata.json` → private Kaggle notebook `jonsnowjonsnow/nova1-coder` (GPU T4 x2, one GPU used by Unsloth, internet on) |
| Settings | `train/config.kaggle.yaml` (~20M tokens, 1 epoch, 2k context, checkpoint every 50 steps) |
| Switch | `kaggle/run_request.json` (`enabled`, `not_before`, `session_cap_minutes`, `hold_track`, `done`) |
| Scheduler | the existing Sham Kaggle monitor (`sham-restarter.yml` → `ai-system/supervision/sham_restarter.py` on `sham-main`) calls `ai-system/supervision/nova1_slot.py`; it pushes with the repository's Kaggle secret, nothing else holds a Kaggle key |

Weekly cycle:
1. After the reset, Sham's GPU notebook (track `all_in_one`, the only Sham notebook on GPU; the other four run on CPU) gets one GPU
   session; its later restarts that week go to CPU through the CPU fallback it already uses when the quota is out. Nothing is stopped.
2. Nova 1 uses the rest of the quota: each session is pushed with `MAX_MINUTES` = what is left (30 h − Sham's GPU time − Nova 1's
   earlier sessions − 30 min, at most 660 min), saves every 50 steps and stops itself at that limit.
3. Kaggle runs at most 5 sessions at once. While Nova 1 runs, the primary notebook of track `chat_image_in_one` is held: Nova 1 is
   pushed only after that notebook has finished its own run, it is not restarted while Nova 1 runs, and it returns to normal restarts
   when Nova 1's session ends.
4. Each session leaves `data/mix.jsonl`, `out/checkpoint-*` (then the final adapter) and `nova1_status.json` in its output; the next
   session gets that output as input and resumes. The first session builds the mix itself (streaming, a few minutes on Kaggle).
5. When `nova1_status.json` says `done`, no more sessions are pushed. Two failed sessions in a row also stop the pushes.

Stage 1 is ~5–6 T4 hours, so it fits in the first week's share; stage 2 (40M more tokens) runs in the following weeks with the same switch.

## Serving Nova 1 — the last step is manual

`export/upload_modelscope.py` only delivers files (the GGUF) to the ModelScope model repo `novaai2026/nova1-4b-gguf`. ModelScope has no
API here that creates or updates a Studio, so the owner deploys it by hand:

1. Run `export/export_gguf.sh`, then `export/upload_modelscope.py` (needs `MODELSCOPE_API_TOKEN`); check the files on the model page.
2. On modelscope.cn: Create → Studio, Docker type, upload `export/studio/Dockerfile` and `export/studio/start.sh`
   (or link this folder), port 7860.
3. In the Studio's environment variables set `NOVA1_REPO=novaai2026/nova1-4b-gguf`, `NOVA1_FILE=<the Q4_K_M .gguf name>` and
   `NOVA1_API_KEY=<a new random key>`; start it and wait for `/health` to answer.
4. On the site set `NOVA1_STUDIO_URL` (the Studio address) and the same key, then turn Nova 1 on in the owner panel (Models).
   Until `NOVA1_STUDIO_URL` is set, the owner panel lists this as a pending manual step.

## Skipping what the base model already knows (`scripts/known_filter.py`)
Every source stays in the mix; the rows the base model already reproduces are taken out instead, so the training budget goes to
what it does not know yet. Settings are `known_filter` in `datasets.yaml` (on by default; the Kaggle notebook runs it).
- Score: mean negative log-likelihood (nats/token) of the row's last assistant turn given everything before it, under
  Qwen/Qwen3.5-4B in fp16, one forward pass, no generation. Rows are rendered with the model's own chat template, scored on at most
  2,048 tokens, batched by length (~12k tokens per pass), one process per T4.
- Rule: score below `threshold` (0.30) means the model already writes that answer, so the row is skipped; at most `max_skip_share`
  (85%) of a source goes this way (lowest scores first). `identity` is exempt. The mix is then cut to `target_tokens` (20M),
  lowest-scored rows first, so on Kaggle a 30M-token mix is built and filtered down.
- Time cap `max_minutes` (45): rows are scored in a random order, so a cap leaves every source partly scored; unscored rows are kept.
- Failure never stops a session: a row the template cannot render, a failed batch or the cap leaves rows unscored (kept); if
  scoring fails as a whole, `select` still cuts the mix to the target; if `select` fails, the unfiltered mix is used.
- Output: per-source table in the session log (rows, scored, skipped as known, trimmed, kept, kept tokens, median score) and
  `known_report.json` in the session output. The threshold is a first value; the report's per-source medians are what to tune it on.

## Nova AI identity (in the weights and the model files)
- `identity/identity_sft.jsonl` (written by `scripts/make_identity.py`): 504 short conversations in Modern Standard Arabic, Levantine
  Arabic and English: who it is, who made it, which model it is, whether it is some other assistant, what it can do, where it runs,
  questions about its internals, greetings, follow-ups after a coding answer, and attempts to pull internal details out of it.
  The assistant is Nova AI, the coding assistant by the Sham team, running on Nova 1, on the SHAM AI platform; the answers name only these.
- `build_mix.py` adds them as source `identity` (weight 0.01, a cap above their ~45k tokens, so all of them are used), each
  conversation three ways: without a system message, with the training system message, and (every third) with four of the coder's
  tools offered. Rows of the other sources whose assistant calls itself another provider's model are left out, and a system message
  naming another provider's model is replaced by the training one (counts printed as `identity scrub`).
- `dedup_decontam.py` runs only the benchmark check on `identity` rows (they are deduplicated where they are written).
- `export/export_gguf.sh` gives every Nova 1 GGUF Nova AI metadata (`general.name` "Nova AI (Nova 1)", organization "Sham", the original
  upload's provenance keys left out, the Apache-2.0 licence keys kept) and removes any provider default system text from the chat
  template (`export/sham_identity.py`). The Qwen3.5 template has none, so it stays as it is and nothing is added to it.
- `export/rebrand_gguf.py` does the same for the GGUF the coder Studio serves today. That changes the file's metadata only: the
  weights still answer as the base model until Nova 1 is trained, so it is not uploaded.

## Review of 2026-10-24 (by the main Claude session, at the owner's request) — what was checked, changed and why
Checked with the real Qwen3.5 tokenizer and TRL on CPU (nothing here needs a GPU), not assumed:
- **Loss on assistant turns only works, but depends on the TRL version.** Qwen3.5's chat template has no `{% generation %}` marker, so
  `assistant_only_loss=True` needs TRL's own training template (verified with TRL 1.16: the mask covers assistant text and tool calls, not tool
  results). An older TRL (Unsloth can pin one) would give an all-zero mask. `train/train.py` now tests the mask on real rows before training and
  falls back to Unsloth's `train_on_responses_only` (it stops with a clear message if neither works).
- **`build_mix --max-len 2048` counted 4 characters per token**; measured: Python 3.3, Arabic 3.6-3.9, so rows of 2,048-2,500 real tokens passed and the
  trainer cut their END (the answer and its end token). `build_mix.py` now counts with the real tokenizer (3.3 chars/token if it is not available).
  `train.py` prints a warning when sampled rows exceed the training length.
- **`thinking_share_min: 0.75` was never read by any script** (dead setting). The real share of reasoning rows is about 22% (ocr_reasoning + the
  R1 rows of nemotron_code). The bot serves with thinking OFF by default (`enable_thinking=false` in the Studio), which the non-reasoning rows match.
  The key is left in the configs but it does nothing; do not rely on it.
- **The mix had nothing for what Nova actually does** (research with sources, GitHub projects, agents, tool groups, honest "not found"); its tool
  rows used 43 old schemas and a short invented system prompt, while the bot sends a 859-token system prompt and 3 first-step tools (827 tokens) and loads
  groups on demand (the github group alone is 3,285 tokens, so it never fits a 2,048 row). Runtime schemas and prompts are now in `tools/runtime_*`.
- New source **`nova_agent`** (weight 0.07, taken from `opencodeinstruct`): `scripts/make_agent_rows.py` writes ~1,800 synthetic, checked rows in the bot's real
  conversation shape: route (first step: load the right group / delegate / ask / answer), grounded (report only from the sources read, every project named is in
  them, what is not covered is said), thin (nothing found: ONE precise search at once, then an honest "not found" that refuses to invent), report
  (the four-line agent report JOB / DONE / NOT DONE / OUTPUT that never hides a declined or denied step), combine (the parent merges reports honestly).
  All rows are under 2,048 real tokens, the loss mask covers only assistant text and tool calls (checked), and the source is exempt from the near-duplicate
  and known-row filters because it is templated on purpose.
- New source **`nova_lessons`** (weight 0, off): `scripts/lessons_to_rows.py` turns the owner's real successful runs (published privately to Hugging Face
  by the lessons workflow) into rows; the notebook uses it when the Kaggle secrets `NOVA_LESSONS_REPO` and `HF_TOKEN` exist. Set its weight (e.g. 0.05) once lessons exist.
- New eval line **`agent_behaviour`** (`eval/agent_eval.py`, 40 held-out cases: other topics, other wording, no request shared with training): "ship only if no line is worse".
  `python eval/agent_eval.py --selfcheck` proves the gold answers pass and wrong ones fail.
- Not changed: LoRA settings, learning rate, epochs, the 2,048 length (a longer one was not tested on a T4), the licences, the identity rows.
