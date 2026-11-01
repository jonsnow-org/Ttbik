# coder-sandbox

A small, capped "computer" for the coder bot: one throw-away Linux container per task, driven over HTTP.
It is separate from everything in `deploy/` — its own compose project, image, network and port.

## Limits (per task container)

| | |
|---|---|
| CPU | 1 core (`--cpus 1`) |
| Memory | 1 GB, no swap (`RUNNER_MEMORY_MB`, hard cap 2 GB) |
| Processes | 128 (`--pids-limit`) |
| Disk | read-only root; `/work` tmpfs 512 MB, `/tmp` tmpfs 128 MB — nothing touches the host disk |
| Privileges | user 1000, all capabilities dropped, `no-new-privileges` |
| Mounts | none from the host |
| Network | own bridge `br-coder-sbx`, no container-to-container traffic, no access to private / link-local / metadata ranges or the host; egress shaped to 20 Mbit (`RUNNER_EGRESS_RATE`) |
| Lifetime | default 30 min, default 30 min; configurable hard cap 60 min; each command max 5 min; reaped every minute |
| Count | 1 at once in the production zero-cost profile (`RUNNER_MAX_BOXES`, hard cap 2) |

The runner itself is capped at 0.25 CPU / 256 MB.

It steps aside for Sham: while `deploy/oracle/agent/SHAM_ON` exists (read-only mount), or available host memory is under 1.8 GB
(`RUNNER_MIN_FREE_MB`, hard minimum 1.2 GB), or one task container is already running, new tasks get HTTP 503. The application then
uses only the local Light JavaScript runtime; it does not switch to a provider that may bill the account. Running tasks are not killed.

## Install on the Oracle VM (one time, as a user that can run docker)

```sh
cd /opt/ttbik            # the existing checkout; only coder-sandbox/ is used
sudo ./coder-sandbox/install.sh
```

The script writes `coder-sandbox/.env` with a random `RUNNER_SECRET` (shown nowhere; read it with
`sudo grep RUNNER_SECRET coder-sandbox/.env` when setting the site env), builds the images, creates the network,
adds the firewall and egress rules, and starts the runner on `127.0.0.1:8790`.

The runner is only on localhost. To reach it from the site it needs an HTTPS address, either:

- a route in the existing Caddy config (e.g. `/coder-sbx/*` → `127.0.0.1:8790`), or
- a Cloudflare tunnel to `http://127.0.0.1:8790`.

## Site env (Vercel)

The production zero-cost chain has exactly one full Linux backend:

| Backend | Variables | Production status |
|---|---|---|
| Oracle runner | `CODER_SANDBOX_ORACLE_URL` (HTTPS base; defaults to `https://PUBLIC_HOST/coder-sbx`), optional `CODER_SANDBOX_ORACLE_SECRET` (otherwise derived from the existing Telegram bot token) | Enabled when Oracle is reachable and has capacity |
| Light JS | none | Automatic last resort; no Linux shell, npm or network |

Vercel Sandbox, CodeSandbox VM, Codespaces, Daytona and E2B are deliberately disabled from application backend selection. Do not add their API keys to enable failover: their VM compute is metered or depends on personal credits that have not been verified as permanently free. The app must never silently fall back to them.

`SANDBOX_BACKEND` accepts `oracle`, `light` or `off`; unknown/provider names are ignored. Default is `oracle`, but if Oracle is not configured the Linux backend list is empty and the app moves to Light only.

## Disabled providers

The legacy CodeSandbox and GitHub Codespaces adapter code remains for isolated tests and historical reference, but the production zero-cost
policy does not call it. CodeSandbox VM forks consume credits; GitHub Codespaces are personal-account monthly allowances and must not be
treated as unlimited shared compute. Daytona and E2B are also disabled because their free allowances are credits, not guaranteed permanent
zero-cost capacity. No fallback provider should be enabled merely because an API key is present.

## API

All requests need the header `x-runner-key: <secret>`.

```
GET    /health
POST   /v1/boxes                 {name, timeoutMs}
GET    /v1/boxes/:name
DELETE /v1/boxes/:name
POST   /v1/boxes/:name/exec      {cmd, args, cwd, timeoutMs, detached}
PUT    /v1/boxes/:name/files     {path, contentB64}
GET    /v1/boxes/:name/files?path=
POST   /v1/boxes/:name/extend    {ms}
```

Tests: `node --test coder-sandbox/runner.test.mjs`
