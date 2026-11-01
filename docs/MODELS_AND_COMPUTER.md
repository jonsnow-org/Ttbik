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
