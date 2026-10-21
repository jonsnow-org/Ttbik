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
(`config.radeon.yaml`, ~120M tokens) is an estimated 12–18 GPU-hours: well inside the 100 starting points, about one week at
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
