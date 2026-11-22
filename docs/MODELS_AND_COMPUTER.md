# Models and the dedicated computer hub (2026-11-02)

Inference and media weights remain isolated by model. The execution host is now a separate, dedicated computer-only Studio.

| Model | Chat Studio | Image / media | Computer |
|---|---|---|---|
| Nova AI (\`coder\`) | \`coder-inference-server\` 1–5 | Nova's own image/speech/video Studios | Mini App computer hub; private \`user:coder\` session |
| Nova 2 (`nova2`) | Its own international Studio | dedicated `NOVA2_MEDIA_STUDIO_URL` only; otherwise unavailable | dedicated `NOVA2_COMPUTER_STUDIO_URL` only; never Nova's hub |
| Sham (old) | \`sham-v1-server\` | Its own media route | Its own embedded computer inside its Studio |
| Sham Pro (\`sham_v2\`) | \`sham-v2-server\` (+ overflow) | Its own image/audio/video Studios | Its own embedded computer (model_computer) inside \`sham-v2-server\` |

## Independence rule (owner, 2026-11-18)

Every model is independent: its own computer session, tools, chats, working state, memory and data. No routing between models and no silent fallback.
- Nova 2 keeps its working state, threads and long-term memory under \`<chat>#model:nova2\` , never in Nova's rows.
- Nova 2's child agents use its own Studio pool; its one current Studio runs one child serially.
- Nova 2's GitHub access uses `NOVA2_GITHUB_TOKEN` / `AI_NOVA2_GITHUB_TOKEN`. Nova's OAuth connections and MCP servers are unavailable to it.
- Nova 2's computer/media routers fail closed unless `NOVA2_COMPUTER_STUDIO_URL` / `NOVA2_MEDIA_STUDIO_URL` point to independent Studios; they never reuse Nova's `COMPUTER_STUDIO_URL` or `NOVA_MEDIA_STUDIO_URL`.
- The Mini App binds every screen to the selected model (\`src/lib/miniAppBinding.ts\`): Chats lists only that model's chats, the Computer tab opens only that model's computer (no picker), running tasks / stop-all / memory are scoped to it, and every tab remounts on a switch. Tests: \`src/lib/__tests__/miniAppBinding.test.ts\`.

## The computer host

\`nova-inference-server\` is the private 2-vCPU / 16-GB ModelScope Studio reserved exclusively for execution. The MiniCPM-o 4.5 big-model app was removed from this Studio. Its model download cache is retired; only the exact \`donor-bakeoff/minicpmo45-big/model_cache\` directory is deleted during migration. Candidate inference and media repositories are unchanged.

The host runs no LLM, image, audio or video weights. It provides:
- Persistent Linux terminal, files, repository checkout/search and background jobs.
- Chromium headless browser with separate user+model contexts and cookies.
- Xvfb/Openbox graphical desktop controlled through authenticated Gradio RPCs.
- Private unprivileged UID and home for every user+model key under \`/mnt/workspace/computer\`; browser data lives under \`/mnt/workspace/browser\`.
- Eight-GB per-session workspace quota, a memory watcher, clean terminal environment and no provider credentials passed into shell processes.

The Studio provides two CPU vCPUs with a bounded multi-session scheduler: up to six shell jobs globally (and a per-session job cap of four), guarded by the live free-memory admission gate. The 16 GB app config supports up to five separate graphical desktop slots when total memory is above 12 GB; each new desktop requires at least 3 GB free RAM, while new terminal jobs require at least 2 GB available. `COMPUTER_QUOTA_GB=8` is the per-session workspace disk allowance, not the Studio RAM allocation. Compiler and language runtimes (Node.js, GCC, Go, Java, Rust, Ruby, PHP, etc.) are installed in the extended developer-tool phase and are checked separately from the initial terminal bootstrap. With inference weights removed, the computer is no longer competing with MiniCPM for the Studio's memory.

## Router

`src/lib/browserComputer.ts` routes Nova 1 to `COMPUTER_STUDIO_URL`; Nova 2 uses only `NOVA2_COMPUTER_STUDIO_URL` and fails closed until its separate computer-only Studio is provisioned. Each session key includes the verified user and selected model. Media generation always uses the selected model's separate media Studio, never a computer endpoint.

## Verification

The deployment must report \`role=computer-only\`, \`model_loaded=false\` and revision \`computer-hub-16gb-2026-11-11-r9-mount-probe\`. The live smoke test verifies Bash, persistent file read/write, background jobs, an X11 screenshot and Bash while the desktop is running. Chromium has a separate live page-open check after bootstrap.

## Handing the computer to the user (2026-11-18)

Nova AI can hand their own configured computer screen to the user for a step only the user should do on their account (sign-in, 2FA, captcha or final confirmation). Sham and Sham Pro use their own embedded screen. Nova 2's computer Studio is not provisioned yet, so its handoff is unavailable until `NOVA2_COMPUTER_STUDIO_URL` points to a separate computer-only Studio. The handoff tool is model-local: Nova in `coderAgent.ts`, Sham/Sham Pro in `shamExec.ts`.

- Nova AI: the run waits like `ask_user` (`run.asking.kind = "handoff"`), a `screen` task event carries `{model, handoff, resume:"run", slot}`, and the Mini App opens that model's live screen with the **You have control** bar (`ComputerHandoffBar.tsx`). Nova 2 is excluded until its own computer Studio is provisioned. Done / Not now call `handoff_done` and resume only the selected model's waiting run.
- Sham / Sham Pro: the round ends with the handoff; Done sends a short `[الحاسوب] …` follow-up message that continues the chat.
- Each model is reached only through its own computer endpoint (Nova 1 hub session user:model; Nova 2's dedicated computer Studio once provisioned; Sham's own Studio desktop). The login the user typed stays in that model's session only.
- Live proof: `.github/workflows/computer-live-shots.yml` opens the browser on each model's own desktop in a verification session and uploads the pictures.
