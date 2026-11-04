# Studios: model inference, media and the dedicated computer hub

| Service | Studio(s) | Env / router | Purpose |
|---|---|---|---|
| Nova inference | \`coder-inference-server\`, \`-2\` … \`-5\` | \`OPEN_CODER_STUDIO_URL\`, \`OPEN_CODER_STUDIO_URLS\` | Text/code inference only |
| Sham old (v1) | \`sham-v1-server\` | \`SHAM_MODELSCOPE_URL\` | Sham v1 inference |
| Sham v2 | \`sham-v2-server\` (+ replicas) | \`SHAM_V2_URL\` | Sham v2 inference |
| Sham v2 overflow | \`sham-v2-overflow-server\` | \`SHAM_V2_OVERFLOW_URL\` | Sham v2 text overflow only after checkpoint verification |
| Sham v2 video | \`sham-v2-video-server\` | \`SHAM_V2_VIDEO_URL\` | Sham v2 dedicated video generation |
| Nova media | \`nova-media-server\` | \`NOVA_MEDIA_STUDIO_URL\` | Nova image, Arabic speech and real video |
| Candidate inference | \`sham-donor-qwen35-9b-test\`, \`sham-donor-gemma4-e4b-test\`, \`sham-donor-minicpmo45-test\` | candidate-specific routes | Three isolated model evaluations |
| Candidate media | each candidate's \`*-media\` Studio | candidate-specific media router | Candidate-owned image/audio/video weights |
| **Computer hub** | **\`nova-inference-server\` (private 16 GB RAM)** | **\`COMPUTER_STUDIO_URL\` → \`browserStudioFor()\`** | **Full developer terminal/toolchain, persistent files/jobs, Chromium and X11 desktop only; no LLM or media weights** |

## Computer isolation

The private 16 GB \`nova-inference-server\` Studio is reserved exclusively as the computer-only execution host. The 8 GB \`juggernaut-ragnarok-image-test\` is a separate image-model experiment and is not used by the computer. The MiniCPM-o 4.5 candidate remains in \`sham-donor-minicpmo45-test\`; candidate inference and media Studios do not host graphical desktops.

Every supported model identity uses the shared computer host, but **not a shared workspace**. Each API call carries the verified \`user:model\` session key. The Studio creates a separate persistent home, unprivileged UID, browser context/cookie store and desktop session for that key. The 16 GB hub allows up to five independent graphical desktop slots when the runtime reports more than 12 GB total memory, subject to the live free-memory admission gate; up to six isolated shell jobs are admitted globally, with a per-session job cap.

- Shell/files/jobs use \`computer_box.py\` under \`/mnt/workspace/computer\`.
- Chromium stores each session under \`/mnt/workspace/browser\`.
- Xvfb/Openbox uses the same private computer home and UID.
- Terminal processes use a clean environment, unprivileged UID, \`no_new_privs\`, bounded processes/output, an 8 GB per-session disk quota and a memory watcher. Provider tokens are not passed to shell processes.
- The deployment removes only the retired MiniCPM cache path \`/mnt/workspace/donor-bakeoff/minicpmo45-big/model_cache\`; it preserves \`/mnt/workspace/computer\` and \`/mnt/workspace/browser\`.

## Model isolation

Nova, Sham v1, Sham v2 and all three candidate inference/media paths remain separate. The computer hub is a shared *execution host*, not a model endpoint: it does not perform inference or generate media. One model's user+model session cannot read another session's files, jobs or browser state. Media generation remains on the selected model's separate media Studio.

## Tests

The deployment verifies private visibility and 16 GB hardware before changing the reserved Studio, stops its prior runtime, and waits for the computer-only app revision. It then tests Bash, persistent file read/write, a background job, a real X11 screenshot, and Bash while the desktop is running. Chromium is tested separately after bootstrap; if its bootstrap cannot complete, that status is reported as unverified rather than treating the browser test as passed.

## Difficulty routing (fast / strong model)
`src/lib/coderTier.ts`: when `OPEN_CODER_FAST_STUDIOS` (comma list of Studio addresses) names Nova Studios that run a fast model, greetings and short plain questions go to those Studios and code, agent, planning, pictures and every tool step go to the others. Unset = no change. A request is never refused because of its tier (if no Studio of the tier is available, all are used). Tests: `coderTier.test.ts`. Only a model family with two kinds of Studio can use it. Since 2026-11-04 Nova has none (replica 4 is back on Qwen3.5-4B); the fast LFM2.5 is its own model with its own Studio (docs/MODELS.md).
