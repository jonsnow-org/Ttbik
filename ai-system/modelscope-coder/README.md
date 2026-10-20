# coder — open coding model on its own ModelScope Studio

The commercial daily-use coding model, **separate from Sham** (Sham's Studio, notebooks, datasets and code are not touched by anything here).

| | |
|---|---|
| Model | `unsloth/Qwen3.5-4B-GGUF` → `Qwen3.5-4B-Q4_K_M.gguf` (2.74 GB, Apache-2.0); fallback `Qwen/Qwen2.5-Coder-7B-Instruct-GGUF` → `qwen2.5-coder-7b-instruct-q4_k_m.gguf` (4.68 GB, Apache-2.0). Both verified on modelscope.cn 2026-10-21. |
| Runtime | llama.cpp `llama-server`, release **b11757** (CPU, ubuntu-x64; needs glibc ≥ 2.34 → fine on the Studio's Ubuntu 22.04), sha256 pinned in `app.py` and in the workflow. |
| Context | `-c 32768` (env `CODER_CTX`, never below 8192). No answer-length cap (`max_tokens 0`, `-n -1`). |
| API | Gradio call protocol, same as Sham's Studio: `chat`, `job_result`, `cancel`, `status` (see the docstring of `app.py`). |
| Queue | one generation at a time, FIFO, nobody refused; long answers continue as a job the bot polls. |
| Studio | `novaai2026/coder-inference-server` (private, free CPU hardware only), created and updated by `.github/workflows/deploy-modelscope-coder.yml` with the existing `MODELSCOPE_TOKEN` secret. The workflow carries the llama.cpp tarball because the Studio cannot reach github.com. |

Measured on the box (2 threads, like the free 2 vCPU Studio): load ≈ 4 s from disk, ≈ 4.6–5 tokens/s generation, native tool calls work (`--jinja`).
A full harness run (read a file on GitHub → answer → try a push to `main` → stopped at the confirmation button) took ≈ 2 min 17 s.

`combined_app.py` = design only, for an account limited to one Studio: Sham + coder in one app with `coder_` api names and 1 CPU thread for the
coder. It is **not** deployed; it would replace the Studio entry file, so the owner decides first.

Bot side: `src/lib/openCoderStudio.ts` (client), `src/lib/coderAgent.ts` (tools + the only guardrail), `src/lib/coderSections.ts` (/mode,
job/detach loop), `src/app/api/coder/continue/route.ts` (next leg of a long run).
