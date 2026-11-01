# Ttbik Cloud Computer

## Purpose

The cloud computer is a persistent Linux VM, not a terminal tab or a per-task shell. It gives the user a real graphical desktop, browser, file system, process environment and a shell. The existing Terminal tab remains the task/event log viewer.

## Isolation model

- One persistent Daytona Linux VM per verified Telegram account and selected model.
- The VM identity is derived on the server from the salted account key and the canonical model ID. The client never supplies a sandbox ID, provider name or another account's locator.
- Nova, Sham v1, Sham v2 and each donor candidate map to different model IDs and therefore different VM names and database rows.
- Provider names are deterministic hashes; the database stores the user's own opaque machine mapping.
- Daytona Linux VM sandboxes provide a dedicated VM/kernel, filesystem and network stack. Do not replace them with a shared Linux container for this feature.
- No application environment secrets or provider credentials are copied into the guest VM.
- Provider API credentials stay server-side. The desktop is exposed through a signed preview URL with a 15-minute lifetime.

## Provider and VM profile

Provider: Daytona v0 API / default Linux VM snapshots.

| Access | Default snapshot | vCPU | RAM | Disk |
|---|---|---:|---:|---:|
| Owner | daytona-vm-large | 4 | 8 GiB | 10 GiB |
| Plus | daytona-vm-medium | 2 | 4 GiB | 8 GiB |
| Pro | daytona-vm-large | 4 | 8 GiB | 10 GiB |

The profile can be overridden by these server-only settings:
- `DAYTONA_API_KEY`
- `DAYTONA_API_URL` (defaults to `https://app.daytona.io/api`)
- `DAYTONA_TOOLBOX_URL` (defaults to `https://proxy.app.daytona.io/toolbox`)
- `CLOUD_COMPUTER_OWNER_SNAPSHOT`
- `CLOUD_COMPUTER_PLUS_SNAPSHOT`
- `CLOUD_COMPUTER_PRO_SNAPSHOT`

Use Daytona's default `daytona-vm-*` snapshots for now. Its VNC and Computer Use stack is available in the default images; custom snapshots require the VNC/desktop packages to be installed and validated before use.

## Lifecycle and persistence

The VM is configured with:
- `autoStopInterval: 0`
- `autoPauseInterval: 0`
- `autoDeleteInterval: -1`
- `ephemeral: false`

It therefore stays running until explicitly stopped. Manual stop must retain the same sandbox ID and persistent filesystem; the next open starts that same VM. Do not set auto-delete to zero: Daytona interprets zero as delete immediately after stop.

A persistent always-on VM incurs provider compute charges while it is running. The UI offers an explicit **Stop and keep files** action. A stopped VM retains its disk; it does not consume running VM CPU while stopped.

## Features exposed

For each eligible user/model:
- Unrestricted shell commands inside the VM, subject only to transport/time limits and the user's paid-plan entitlement.
- Read and write files in the guest.
- Mouse click, typing, key presses, hotkeys and scrolling.
- Window enumeration and desktop status.
- Screenshots and accessibility metadata. If the selected runtime accepts images, the screenshot goes to that model's own projector; otherwise bilingual Arabic/English OCR runs inside the same model VM and the model receives OCR text, active-window metadata and its accessibility tree. This prevents a missing projector from blocking desktop operation, without routing the screen to another model.
- A persistent PTY shell session integrated in the same computer: xterm.js renders ANSI terminal output, the browser attaches to the model-scoped Daytona Toolbox WebSocket using a short-lived signed preview credential for port 2280, and input, output replay cursor, and resize all target the same PTY. The Daytona project API key never reaches the browser. A full VM stop/start ends the shell process; the persistent filesystem remains.
- Browser/desktop use through the signed VNC preview inside the Mini App (with an external-browser fallback).

Nova and donor candidates receive the shared computer tool group through the coder agent bridge. Donor candidates get their native screenshot image only when their own MTMD runtime reports vision capability; otherwise OCR and accessibility metadata are computed in that same candidate VM. Sham receives the equivalent tools through `ShamHost`, and Sham screenshot interpretation uses the selected Sham Studio's `understand_media` endpoint. No cross-model computer or media fallback is allowed.

The existing task-scoped sandbox remains available only to legacy/disposable task tools. The old standalone Terminal tab is removed; the PTY, file manager and model-filtered task activity live inside the Computer workspace. The default Nova Mini App exposes this workspace as a first-class tab for accounts whose server-verified plan includes the computer feature.

## Plan access

- The owner is allowed.
- Other accounts need an active paid coder subscription (Plus/Pro or another active paid plan).
- The Free plan does not receive the Computer tab or machine provisioning.
- Existing `sandbox_minutes` usage limits apply to model-driven shell and control requests. The guest operating system itself has no command-name allowlist. Provider runtime charges are separate from the application's tool-time meter.

## API operations

The authenticated Mini App API uses Telegram-signed initData and provides:
- `computer_status`
- `computer_open`
- `computer_refresh`
- `computer_stop`
- `computer_self_test` (owner only)

The model tool layer uses the same internal cloud-computer service. It does not accept a client-supplied sandbox ID.

## Acceptance and rollout gates

The automated test suite checks:
1. deterministic, distinct identities across accounts and model IDs;
2. persistent mapping per identity;
3. VM provision and snapshot/lifecycle flags;
4. unrestricted shell dispatch (no application command allowlist);
5. desktop start and signed preview URL;
6. write/read file round-trip;
7. manual stop and resume with the same VM ID and file contents;
8. persistent PTY identity per account/model, signed WebSocket ticket, cursor replay, resize and same-session input;
9. mouse, keyboard, hotkey, scroll and window operations;
10. screenshot response and the owner self-test report.

The owner self-test calls the actual Daytona provider and exercises the live desktop. CI uses a fake provider and cannot prove that the connected Daytona account can provision a real VM. Before public rollout, run the owner self-test on a Preview deployment with `DAYTONA_API_KEY` configured, verify the VNC session in Telegram and an external browser, and inspect a second test account to confirm its sandbox ID and files are different. Do not enable public rollout until this live test is green.


## Background tasks and Telegram delivery

The bot must acknowledge Telegram updates quickly; the model/agent run is not held open by the webhook. The current implementation uses a persisted run/task state, task event log, a 30-second execution leg, a signed continuation endpoint, and the Oracle one-minute sweeper to resume orphaned runs. The user can send a new message while a task runs; it enters the run inbox and is consumed on the next step. Progress and final reports are sent as Telegram messages, while Mini App tasks keep their output in the activity stream.

This is an incremental continuation design, not yet a standalone always-on queue consumer. To remove Vercel invocation lifetime as a long-term dependency, the next architecture milestone is a durable Postgres-backed work queue and an always-on worker process (existing Oracle worker or a separately provisioned worker service). That worker should claim jobs with leases, checkpoint each model/tool step, persist media/file references, retry transient errors, and deliver notifications independently of a Telegram webhook or Vercel request. Do not claim this milestone is deployed until the worker service and queue are actually wired and live-tested.


## Terminal implementation and remaining live gate

The in-tab terminal now uses xterm.js and a real Daytona PTY process. The backend provisions one persistent PTY per verified account/model, retains an output cursor, and mints a short-lived signed preview URL limited to Toolbox port 2280. The browser attaches directly to the WebSocket path on that signed host; it receives binary PTY frames and sends keystrokes without receiving the project API key. PTY resize is forwarded to the Toolbox process resize route.

The official Daytona documentation describes PTY attach as a WebSocket stream with binary output frames, cursor replay, and input sent as text/binary frames. It also identifies port 2280 as the Toolbox interface and signed preview URLs as port-scoped expiring credentials. These code paths are covered by fake-provider regression tests; **they are not proof of a live provider connection**. The Preview acceptance test must still provision a real VM, open xterm, type a command, observe output, resize the terminal, reconnect using the same session, and verify that another model cannot attach to it. Do not mark the computer fully production-ready until this live test passes.
