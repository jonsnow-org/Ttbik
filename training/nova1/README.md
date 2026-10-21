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

## Free compute (checked 2026-10-21; Kaggle not counted)
| option | free amount | fits phase 1? | sign-up |
|---|---|---|---|
| Modal (Starter) | $30 credit every month | yes — ~10 h on an L4/A10G covers one full run | GitHub or Google login |
| Lightning AI | one-time up to 30 credits (5 at sign-up, +25 after adding a card), expire in 12 months | yes, one or two runs | account; card for the larger grant (not charged on free tier) |
| ModelScope Notebook | one-time 36 GPU-hours for new users; sessions ≤ 10 h; CPU notebooks free | yes, one run in 3–4 resumed sessions | Alibaba Cloud account with real-name verification |
| Google Colab (free) | T4 when available, ≤ 12 h sessions, can be cut | smoke runs, eval, GGUF export | Google account |
| Oracle runner (ours) | CPU only | trace collection (Docker), dedup, decontamination, GGUF quantising — not training | already running |

## Later phases (not in this run)
Phase 2: longer agent traces from production (with consent) and preference tuning on passing vs failing fixes. Phase 3: broader
Arabic technical writing and docs. Each phase gets its own section in `datasets.yaml` and its own eval line.
