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
- Screenshots, passed to the selected model's own vision path.
- Browser/desktop use through the signed VNC preview inside the Mini App (with an external-browser fallback).

Nova and donor candidates receive the shared computer tool group through the coder agent bridge. Sham receives the equivalent tools through `ShamHost`, and Sham screenshot interpretation uses the selected Sham Studio's `understand_media` endpoint. No cross-model computer or media fallback is allowed.

The existing task-scoped sandbox remains available for short, disposable subprocess tasks; it is not the user's persistent computer. The Terminal tab continues to show job logs and does not get deleted.

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
8. mouse, keyboard, hotkey, scroll and window operations;
9. screenshot response and the owner self-test report.

The owner self-test calls the actual Daytona provider and exercises the live desktop. CI uses a fake provider and cannot prove that the connected Daytona account can provision a real VM. Before public rollout, run the owner self-test on a Preview deployment with `DAYTONA_API_KEY` configured, verify the VNC session in Telegram and an external browser, and inspect a second test account to confirm its sandbox ID and files are different. Do not enable public rollout until this live test is green.
