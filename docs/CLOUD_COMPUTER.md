# The shared isolated graphical computer and distributed task workers

## Architecture

The application exposes one authenticated computer surface backed by the reserved, private 16 GB ModelScope computer hub (`nova-inference-server`). It is an execution host, not a language model or a media generator. Work is split between three different execution resources:

1. **Dedicated ModelScope computer hub.** Terminal, persistent files, jobs, Chromium and the graphical desktop run here. Every session is isolated by verified user ID and selected model ID; users and models do not share home directories, browser cookies or desktop sessions.
2. **Model-specific ModelScope inference and media Studios.** Nova, Sham v2 and each candidate retain their own inference and media weights. Image, speech and real video generation execute on the selected model's assigned media Studio, not on the computer hub.
3. **Oracle Linux runner and GitHub Actions.** Oracle handles eligible task-scoped Linux work; GitHub Actions handles discrete CI/build/test/export jobs. Neither is presented as a persistent interactive desktop.

The application may move a task between workers only after saving its files, logs and next step. A live process, browser window, in-memory state or open graphical session is never claimed to have migrated between hosts.

## Dedicated ModelScope computer

All supported models use the same private computer-only Studio URL, but **not a shared workspace**. A session identifier is derived on the server from the verified user ID and selected model ID; the server does not trust an arbitrary client locator.

### Three interfaces backed by isolated sessions

- **Persistent Linux workspace** (`computer_box.py`): shell commands, file read/write, repository checkout, local search and background jobs. Each user/model session has a hashed workspace, a separate unprivileged Unix UID and a private home under `/mnt/workspace/computer`.
- **Headless browser** (`browser_computer.py`): JavaScript-capable Chromium controlled through bounded browser actions. It uses a per-session browser context, cookies and persistent directory.
- **Graphical desktop** (`desktop_computer.py`): Xvfb display server, Openbox window manager, terminal, file manager and an optional visible Chromium window. It returns JPEG screen frames through the authenticated Gradio API and accepts bounded mouse, keyboard and scroll actions. It does not open a public VNC port or require a Docker socket.

The Mini App exposes the graphical desktop in its own tab. The headless browser remains a separate automation interface, and terminal/files views use the same private user+model workspace as the selected model's computer tools.

### Admission and isolation controls

- Desktop start is refused unless `/proc/meminfo` reports at least **3072 MB MemAvailable**. Unknown memory is a refusal, not an assumed pass.
- The 8 GB hub can allocate up to three isolated desktop slots, but every start is guarded by its live memory check. Shell jobs and browser contexts have their own bounded concurrency limits.
- The desktop is assigned to its own user+model slot. Other sessions receive a busy/capacity response without seeing another session's ID, display or screenshot.
- Child applications run under that session's Unix UID, with a clean environment that does not pass Studio secrets into the desktop process.
- The desktop will not start a network-capable session unless the Studio confirms its UID-scoped private-network and metadata egress rules.
- Input is restricted to named desktop actions. Mouse coordinates, text length, scroll count and keyboard key names are bounded server-side.
- Idle desktop sessions are stopped after the configured inactivity window. Workspace files remain in persistent storage.

The display refreshes approximately every two seconds. This is an interactive remote desktop surface, not a 60-fps GPU workstation. Large graphical workloads, GPU-dependent applications and high-frame-rate media editing are outside the CPU-only computer profile.

## First start

The first graphical start installs the small X11 package set through the Studio's configured package mirror, then starts Xvfb and Openbox. If the Studio does not have root access, a package mirror, enough free memory or a working egress firewall, start fails closed and reports the reason. A failed start does not claim that a desktop is running.

The visible browser reuses Chromium only when a non-headless executable is present. The separate headless Chromium interface remains available independently.


## Oracle task runner

Oracle is the primary external Linux worker for task-scoped execution. The configured runner endpoint is served behind the existing Caddy route /coder-sbx/* and authenticated with x-runner-key. The secret remains on the server and never enters the guest container or browser.

The production profile remains conservative:

| Resource | Limit |
|---|---:|
| Container CPU | 1 core |
| Container memory | 1 GiB, no swap |
| PIDs | 128 |
| /work tmpfs | 512 MiB |
| /tmp tmpfs | 128 MiB |
| Concurrent boxes | 1 |
| Task lifetime | 30 minutes maximum |
| Host free-memory floor | 1.8 GiB (hard minimum 1.2 GiB) |

The container uses a read-only root filesystem, no host mounts, dropped Linux capabilities, no-new-privileges and an isolated network. New boxes are refused while the SHAM memory-protection flag is active, host memory falls below its floor, the runner is unhealthy or the box limit is reached.

If Oracle refuses a new task, the task dispatcher may use only the selected model's own ModelScope computer, provided that Studio's own health, free-memory and execution-slot checks pass. If neither Linux worker can accept the task, a limited JavaScript runtime can handle only supported JavaScript operations; it is not presented as Linux.

## GitHub Actions batch lane

GitHub Actions provides a short-lived runner for independent batch work. The input package must include the repository/ref, required files and command. The result package returns artifacts, logs and the exit status. This lane is suitable for CI, build, tests and export.

It does not provide a permanent per-user home, a persistent browser session or a graphical display. It is not a transparent fallback for an interactive Linux task. A task can be resubmitted there only after a checkpoint has been saved.

## Routing and failover contract

- Oracle receives new task-scoped Linux work first while its authenticated health and capacity gates pass.
- The selected model's own ModelScope Studio is the Linux fallback. It never borrows another model's Studio or weights.
- GitHub Actions is selected for discrete artifact-based batch jobs, not as a generic terminal fallback.
- The limited JavaScript runner is last for simple code that fits its restricted runtime.
- Only files, logs, task metadata and the next action are checkpointed. No active process, browser tab, terminal process or X11 display is described as migrated.

## Acceptance checks before enabling a model's desktop

A model's desktop should be enabled only after that exact Studio passes live checks for:

1. Correct model-to-Studio routing and no cross-model URL/weight reuse.
2. Free memory above the admission threshold while the model and its media engine are ready.
3. Xvfb startup, Openbox startup, screenshot capture and a successful mouse/keyboard action.
4. Persistent file read/write under the same user/model workspace used by its shell.
5. A visible browser launch where Chromium is installed, plus a separate headless browser probe.
6. Memory refusal, second-user busy response, stop during startup and idle cleanup.
7. Media generation and shell/browser requests are serialized while the graphical session holds the Studio slot.
8. No Studio secret appears in the child environment, logs, UI payload or guest files.

A passing CI mock proves the software contract only. It does not prove that a particular ModelScope Studio has deployed the latest runtime or that the GUI packages are available there. The live deployment and screen-control checks must succeed on the selected Studio before it is described as ready.

## Background tasks

Long-running model work keeps its own task/run state and event log. The durable state contains checkpoints and the next step; the worker may resume after an application function or Studio process restarts. This is separate from the graphical desktop session. A task restart does not silently restore a prior open browser window or an in-memory process.
