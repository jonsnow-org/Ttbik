# coder-sandbox

A small, capped "computer" for the coder bot: one throw-away Linux container per task, driven over HTTP.
It is separate from everything in `deploy/` — its own compose project, image, network and port.

## Limits (per task container)

| | |
|---|---|
| CPU | 1 core (`--cpus 1`) |
| Memory | 2 GB, no swap (`RUNNER_MEMORY_MB`, hard cap 3 GB) |
| Processes | 256 (`--pids-limit`) |
| Disk | read-only root; `/work` tmpfs 1 GB, `/tmp` tmpfs 256 MB — nothing touches the host disk |
| Privileges | user 1000, all capabilities dropped, `no-new-privileges` |
| Mounts | none from the host |
| Network | own bridge `br-coder-sbx`, no container-to-container traffic, no access to private / link-local / metadata ranges or the host; egress shaped to 20 Mbit (`RUNNER_EGRESS_RATE`) |
| Lifetime | default 30 min, max 45 min; each command max 5 min; reaped every minute |
| Count | 2 at once (`RUNNER_MAX_BOXES`, hard cap 6) |

The runner itself is capped at 0.25 CPU / 256 MB.

It steps aside for Sham: while `deploy/oracle/agent/SHAM_ON` exists (read-only mount), or free memory is under 3000 MB
(`RUNNER_MIN_FREE_MB`), or the box limit is reached, new tasks get HTTP 503 and the site moves on to the next backend.
Running tasks are not killed.

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

| Backend | Variables |
|---|---|
| Oracle | `CODER_SANDBOX_ORACLE_URL` (HTTPS base), `CODER_SANDBOX_ORACLE_SECRET` (= `RUNNER_SECRET`) |
| CodeSandbox | `CSB_API_KEY`, `CODER_CSB_TEMPLATE` (template sandbox id), `CODER_CSB_RUNNER_SECRET` |
| Codespaces | `CODER_CODESPACES_TOKEN`, `CODER_CODESPACES_REPO` (`owner/name`), `CODER_CODESPACES_RUNNER_SECRET`, optional `CODER_CODESPACES_MACHINE` |

A backend without all its variables is skipped. Order: Oracle → Vercel Sandbox → CodeSandbox → Codespaces → Daytona → E2B → light JS runner
(`SANDBOX_BACKEND` can reorder or limit it).

## CodeSandbox (free Build plan)

1. Make a repo (or folder) with `runner.mjs` at the root and `codesandbox/.codesandbox/tasks.json` copied to `.codesandbox/tasks.json`.
2. Import it at codesandbox.io as a sandbox and put the secret (24+ characters) in a file `.runner-secret` next to `runner.mjs`
   (a fork copies the project files; env set in a session does not carry over). This sandbox is the template; keep it private.
3. Create an API key at codesandbox.io/t/api. Each task forks the template on the Pico tier (1 CPU, 2 GB; `CODER_CSB_TIER` to change),
   then shuts the fork down and deletes it.

## GitHub Codespaces (personal account, free monthly hours)

1. Make a personal repo with `runner.mjs` at the root and `codespaces/.devcontainer/` copied to `.devcontainer/`.
2. Add a Codespaces secret `CODER_SANDBOX_SECRET` (24+ characters) for that repo.
3. Create a fine-grained token for that repo with Codespaces read/write, and keep the spending limit at $0.
   Each task creates a 2-core codespace and deletes it afterwards.

The site can only reach the runner on a public port: a private one answers with a GitHub sign-in page (200) or 401, also with
the token in `X-Github-Token`. `.devcontainer/start-runner.sh` asks `gh` inside the codespace to make 8790 public; with the
codespace's own default token that did not happen in the test of 2026-10-21, so this backend stays off for now.

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
