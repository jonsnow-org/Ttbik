# The five models, their Studios and their computer (2026-11-01)

Rules (owner): everything is free; anything paid is a red line. Every model and every user is independent of the others; mixing is a red line.
No model calls another model, its tools, its Studio or its weights. Only the old Sham trains from Nova or another model (training only).

| Model | Chat Studio | Image | Speech / video | Computer |
|---|---|---|---|---|
| Nova AI (`coder`) | coder-inference-server 1-5 | epiCRealism Studio | Nova media Studio | task Linux box (`sandbox_*`) |
| Sham (old) | sham-v1-server | its own | its own | untouched |
| Sham v2 | sham-v2-server (+ overflow) | Realistic Vision V6 Studio | its own video Studio | task Linux box |
| Qwen3.5-9B | sham-donor-qwen35-9b-test | CyberRealistic Studio | sham-donor-qwen35-9b-media | task Linux box |
| Gemma 4 E4B | sham-donor-gemma4-e4b-test | its own copy of Realistic Vision V6 | sham-donor-gemma4-e4b-media | task Linux box |
| MiniCPM-o 4.5 | sham-donor-minicpmo45-test | Umranz Studio | sham-donor-minicpmo45-media | task Linux box |

## The computer
The persistent graphical desktop (Daytona, metered) is off in production (`src/lib/cloudDesktopPolicy.ts`). What replaces it is built on the free Studio each model already owns
(measured: root, 2 vCPU / 8 GB, a persistent `/mnt/workspace`, apt and pip through mirrors). Everything is private to one user and one model and is never shared between models:
- **The computer** (`ai-system/modelscope-media/computer_box.py`, client `src/lib/computerBox.ts`): `computer_run` (a bash command, 90 s), `computer_write`, `computer_read` (file or folder),
  `computer_job` (start / log / stop / list: long work that keeps running between steps), `computer_repo` (a public GitHub repository into `~/repos` in ONE call, with a summary),
  `computer_search` (ripgrep over local files). Each session has a private unprivileged Unix user and a 0700 home under `/mnt/workspace/computer`; commands get a clean environment
  (the Studio's secrets never reach them), `no_new_privs`, process / file-size limits, low CPU priority, a memory watcher (a process group above 3 GB is stopped), a 3 GB disk quota
  and a best-effort iptables block of private ranges and the metadata address (the result is reported by `status`, never assumed).
- **The browser** (`browser_computer.py`, client `src/lib/browserComputer.ts`): one shared Chromium with a context per session, sessions saved to disk when idle, `wait`, `aria`
  (page outline) and drawn-area hints for single-page apps. Chromium comes from a mirror first (Playwright's own host timed out on a real Studio).
- **The task box** (`sandbox_*`: clone / push with the user's GitHub grant): Oracle Always Free runner, then the in-process JavaScript runner. Kept for repository writes.
- Not used, on purpose: Microsandbox (needs KVM, `/dev/kvm` is absent), Bubblewrap (needs user namespaces the host may forbid; probed and recorded), Steel Browser (a second server for what
  Playwright contexts already do).

### The working strategy (how the models are told to use it)
The same seven habits reach every model three ways: `load_tools` answers with them for Nova, the Studio sends them with the FIRST result of every session (once), and they are written to
`~/README.md` (with `~/NOTES.md` for the model's own plan). In short: read `.` and `NOTES.md` first; read a repository with ONE `computer_repo` then `computer_search` (never dozens of API
calls); anything over about 60 s is a `computer_job`; run independent work in parallel; install into the home (it stays); JavaScript pages use the browser, plain pages `web_fetch`; big output goes to a file.

## What makes tasks faster (measured on the 2-vCPU Studios)
- Tool schemas are loaded in groups (`load_tools`); the Studio's prompt cache keeps the shared prefix, so only the first step is slow.
- Candidate tools run through the app server bridge: independent read-only calls of one step run in parallel; slow computer tools (clone, install, tests) get a 175 s window (the route allows 180 s) instead of 38 s.
- A task is a durable Studio job followed by short polls (`chat_start` / `chat_poll`, `/api/coder/donor-continue`): a dropped connection never fails an answer; a restarted Studio gets one automatic resubmission of a text request.
- Reading a repository is one clone plus local search (seconds) instead of dozens of API round trips; `git`, `ripgrep`, `jq`, `unzip`, `curl` are installed once in the background.
- Weights and finished jobs live under `/mnt/workspace` when it is writable, so a restart does not re-download several GB.
- Image generation uses PyTorch fused attention and bfloat16 on AMX CPUs, with an automatic fallback to the proven path.

## How to test a model end to end
- Candidates: `donor-bakeoff-modelscope.yml` (deploy + the full test set, with seconds per test), `redeploy-studio.yml` when ModelScope keeps the old container.
- Nova: `nova-task-live.yml` (a whole task with a per-event timeline), `nova-live-probe.yml` (one request through a Studio).
- Images: `time-image-studio.yml` (one image, timed), `read-image-checkpoints.yml` (the checkpoint hash each Studio reports).

## Review of the "native unified multimodal models in 8 GB" report (2026-11-01) - what applies to us
The report assumes **8 GB of VRAM (a GPU)**. Our Studios are **CPU only with 8 GB of RAM**, so most of its numbers do not transfer. Checked against the Hub and our own measurements:
- **Qwen 3.5 Omni** (an official native audio/video model): not found on the Hub; the "Qwen3.5 ... Omni" repositories are community fine-tunes of the text/vision Qwen3.5-9B. Nothing to adopt.
- **SmolOmni-MLA (256M/500M)**: exists (Tinman-Lab) but is tagged research / proof of concept and English only, so it cannot serve Arabic users.
- **MiniCPM-o 4.5 GGUF**: real (`openbmb/MiniCPM-o-4_5-gguf`, our candidate). Its native speech output needs OpenBMB's `llama.cpp-omni`, documented for CUDA / Metal and about 8-9 GB for the full duplex setup; CPU-only operation is not confirmed. Our llama-cpp-python runner takes audio **in**, not out, so speech output stays in the candidate's own media Studio.
- **Janus-Pro (unified image generation)**: 384 px autoregressive images; on 2 CPUs this is slower than our Stable Diffusion path (about 114 s for 512x768 in bf16) and weaker for Arabic prompts. Not adopted.
- **MLA (multi-head latent attention)** is an architecture of the model, not a switch: our models (GQA / hybrid) do not have it.
- **What does apply:** KV-cache compression and a longer context. Measured on a live candidate Studio: the runner process peaks at about **7.4 GB of the 8 GB** (`VmHWM 7786084 kB`, no swap) with a 2048-4096 token context, so the context cannot simply be raised. The runner's pinned server already supports `flash_attn` and `type_k` / `type_v`; quantising the KV cache to q8_0 (half the KV memory) is the lever to test next, together with a larger `context_tokens`, in the next runner revision (it changes `app.py`, so it must be deployed to the three candidate Studios in one go).
- The "SWE-Bench 80.2 %" and "93.6 % OCR" figures for Janus-Pro / MiniCPM in the report are not backed by anything we could find and were not used.
