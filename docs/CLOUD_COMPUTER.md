# Ttbik Cloud Computer

## Current production state — zero-cost policy

The persistent graphical desktop feature (VNC, browser, PTY, file manager) was originally implemented on Daytona. Daytona is a metered provider with finite promotional credits; it is not a permanent free compute resource. Under the current zero-cost policy:

- The production application does not provision or resume Daytona machines.
- The computer feature is hidden from the production Mini App, so users are not offered a desktop that the app cannot safely provide for free.
- computer_open, desktop actions, terminal-in-desktop and file operations are blocked in production before any provider call.
- computer_status reports that the Daytona desktop provider is disabled. For an existing row that is still marked started, the status check attempts a stop operation; it reports cleanup_pending if the stop cannot be confirmed.
- The explicit computer_stop action remains available so an owner can release a previously created VM. A stopped Daytona VM may retain its filesystem and storage; stopping compute does not necessarily remove all provider storage charges.
- The one-minute production heartbeat still runs the legacy in-app usage meter for rows already marked started. That meter is not a guarantee that provider compute has stopped. The owner maintenance panel checks and attempts to stop the selected account/model's legacy VM, and its owner-only Stop all legacy desktops action enumerates up to 50 active database rows per request and calls the stop API in batches of five. The action reports stopped and pending counts; run it again if more than 50 rows existed or any stop remains pending. Do not infer that all old VMs have been shut down until the action succeeds and the provider account confirms there are no running machines. Stopped disks/snapshots may still have storage charges, so review the provider dashboard before deciding whether to delete old machines.

The Daytona API credential remains stored in the deployment configuration for legacy compatibility and the safe stop path; it is not used to create or resume a desktop in production.

## Available free computer execution

The active production replacement is a task-scoped execution chain, not a persistent GUI desktop:

1. **Oracle runner:** one isolated Docker container per task on the existing Oracle Always Free VM. The container is ephemeral and resource-capped, and it refuses new work when Sham is active, host memory is low, or another task box is already running.
2. **Light JavaScript runner:** an in-process QuickJS/WebAssembly runtime with a per-task file store. It can run limited JavaScript code without shell, npm, network access or host access. It is the automatic fallback when Oracle is unavailable or refuses work.

The application does not automatically use Vercel Sandbox, CodeSandbox VMs, GitHub Codespaces, Daytona or E2B. Their VM access is either metered, dependent on finite credit balances, or dependent on an account-specific free quota that has not been verified for this project. An API key in an environment variable is not evidence that usage is free.

### Oracle runner limits

The production profile is intentionally conservative:

| Resource | Production default |
|---|---:|
| Container CPU | 1 core |
| Container memory | 1 GiB, no swap |
| PIDs | 128 |
| /work tmpfs | 512 MiB |
| /tmp tmpfs | 128 MiB |
| Concurrent boxes | 1 |
| Task lifetime | 30 minutes maximum |
| Host free-memory floor | 1.8 GiB (hard minimum 1.2 GiB) |

The container has a read-only root filesystem, a dedicated bridge with inter-container traffic disabled, no host mounts, dropped Linux capabilities and no-new-privileges. Expired containers are reaped. New boxes are refused while the SHAM_ON flag is present, the host free-memory floor is breached, or the active-box limit is reached.

The runner endpoint is exposed by the existing Oracle Caddy route at /coder-sbx/*. The application authenticates with x-runner-key; when CODER_SANDBOX_ORACLE_SECRET is not explicitly set, both sides derive the same key from the existing bot token. The secret is never sent to the browser or the guest container.

## Important distinction: task runner vs persistent desktop

Oracle's current runner gives the agent a temporary isolated Linux task container. It does not provide a user-facing VNC desktop, a persistent graphical browser session, or a persistent per-account filesystem after the task ends. The Light runner is even more limited.

We will not call either of these a complete replacement for the old graphical desktop. A genuine free desktop alternative would require a separately provisioned Oracle desktop environment with a GUI/VNC service, model/account-specific filesystem isolation, resource arbitration with Sham and the media services, and independent security tests. The current Oracle VM's spare memory is limited, so adding a second desktop workload without live capacity measurements could destabilize Sham or the bots.

## Historical Daytona architecture (not active for new production use)

The former implementation used one Daytona Linux VM per verified Telegram account and canonical model ID. Identity was derived on the server from the salted account key and model ID. The browser never supplied a sandbox ID or provider locator. It used short-lived signed previews for VNC/Toolbox, with provider credentials remaining server-side.

That design had per-model isolation, a persistent disk, a graphical desktop, an interactive PTY and file manager. It also incurred provider compute charges while running, with storage potentially charged while stopped. Those capabilities remain documented for historical context only; they are not an active free production feature.

## API behavior

The authenticated Mini App API still recognizes:
- computer_status
- computer_open
- computer_refresh
- computer_stop
- computer_cleanup_all (owner-only legacy cleanup sweep; up to 50 active rows per request)
- computer_self_test (owner only)

In production, status/stop are kept for legacy resource cleanup; provisioning and interactive operations are disabled by the zero-cost policy. The model tool layer uses server-derived account/model identity and never accepts a client-supplied sandbox ID.

## Acceptance gates before restoring a persistent desktop

Do not turn on a graphical desktop until all of these conditions are met:

1. A genuinely zero-cost Oracle compute allocation is proven from the actual OCI tenancy, not assumed from the free-tier label.
2. A dedicated desktop process (VNC/noVNC or equivalent), browser and PTY are deployed on that Oracle VM.
3. One isolated workspace is provisioned per account and model; no filesystem or process is shared between models or users.
4. Capacity tests demonstrate adequate free RAM/CPU while Sham, media engine and bots are active.
5. Host firewall, reverse proxy, short-lived session credentials and guest egress controls are tested.
6. Stop/start persistence, recovery after runner restart, concurrent users, quota exhaustion and memory-pressure refusal are tested.
7. The owner verifies the real VNC session from Telegram and an external browser on the live Oracle host.

A CI fake provider is not proof that an Oracle GUI desktop exists or that Daytona/Oracle credits are available. Until those gates pass, the supported free workflow is Oracle task containers plus the Light JavaScript fallback.

## Background task execution

The coder agent already uses persisted task/run state, event logs, short execution legs, a signed continuation endpoint and the Oracle one-minute sweeper to resume orphaned tasks. This remains separate from the computer workspace. It is not a queue-based persistent GUI session, and it does not make the task runner's temporary filesystem permanent.
