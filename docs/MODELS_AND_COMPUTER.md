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
The persistent graphical desktop (Daytona, metered) is off in production (`src/lib/cloudDesktopPolicy.ts`). A model's computer is the task-scoped Linux box:
Oracle Always Free runner first (1 core, 1 GiB, one box at a time, 30 min), the in-process JavaScript runner as the fallback. The tools are `sandbox_clone`, `sandbox_exec`,
`sandbox_wait`, `sandbox_write_file`, `sandbox_edit_file`, `sandbox_search`, `sandbox_read_file`, `sandbox_push`. The `computer` group of `load_tools` offers exactly these;
`cloud_computer_*` are not offered while the desktop is off (each call would fail and cost a full slow model step). The box is private to one user and one model
(`chatKey = user + model`).

## What makes tasks faster (measured on the 2-vCPU Studios)
- Tool schemas are loaded in groups (`load_tools`); the Studio's prompt cache keeps the shared prefix, so only the first step is slow.
- Candidate tools run through the app server bridge: independent read-only calls of one step run in parallel; slow computer tools (clone, install, tests) get a 175 s window (the route allows 180 s) instead of 38 s.
- A task is a durable Studio job followed by short polls (`chat_start` / `chat_poll`, `/api/coder/donor-continue`): a dropped connection never fails an answer; a restarted Studio gets one automatic resubmission of a text request.
- Weights and finished jobs live under `/mnt/workspace` when it is writable, so a restart does not re-download several GB.
- Image generation uses PyTorch fused attention and bfloat16 on AMX CPUs, with an automatic fallback to the proven path.

## How to test a model end to end
- Candidates: `donor-bakeoff-modelscope.yml` (deploy + the full test set, with seconds per test), `redeploy-studio.yml` when ModelScope keeps the old container.
- Nova: `nova-task-live.yml` (a whole task with a per-event timeline), `nova-live-probe.yml` (one request through a Studio).
- Images: `time-image-studio.yml` (one image, timed), `read-image-checkpoints.yml` (the checkpoint hash each Studio reports).
