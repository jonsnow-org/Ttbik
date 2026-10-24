# Coder section — operations notes

Everything here is zero cost and none of it shares a quota with the Sham model (no GitHub Actions sandboxes, no Kaggle,
Lightning or ModelScope API-Inference). Every new feature is off or falls back safely when its environment variable is missing.

## Failover chains (health-checked, automatic)

| Chain | Order | Health check / failover | Needs |
|---|---|---|---|
| Model Studio | `OPEN_CODER_STUDIO_URL` → replicas in `OPEN_CODER_STUDIO_URLS` | a connection failure cools that Studio for 60 s and the call goes to the next; a job stays on the Studio that took it (`s<i>~<id>`) | the primary URL (the coder is off without it); replicas = the same Studio duplicated on ModelScope (free) |
| Sandbox (Linux VM) | `vercel` → `daytona` → `e2b` → `light` | quota/auth errors cool a backend for `CODER_SANDBOX_COOLDOWN_MS` (1 h), network/5xx for 5 min; a task sticks to the backend holding its VM | Vercel: nothing on Vercel (OIDC). Daytona: `DAYTONA_API_KEY` (free sign-up credit, no card). E2B: `E2B_API_KEY` (free one-time credit, no card). Light: nothing |
| Web search | primaries Brave + Bing + DuckDuckGo (in parallel) → backups DuckDuckGo-lite, SearXNG (`CODER_SEARXNG_URLS`), Wikipedia API | an engine that fails twice (error, block page, captcha, off-topic answers) rests 10–30 min; backups are asked when the primaries leave fewer than 3 results; if everything rests, all are tried | nothing (SearXNG optional) |

`light` = QuickJS compiled to WebAssembly, in-process, 64 MB / 5 s caps (`CODER_LIGHT_MEMORY_MB`, `CODER_LIGHT_TIMEOUT_MS`):
JavaScript only (`node -e`, `node file.js`), a per-task file store, no shell / npm / network. `CODER_LIGHT=off` disables it.

The Mini App's Settings → "Coder server → Check" shows the live state of all three chains.

## Switches

`CODER_SANDBOX=off`, `SANDBOX_BACKEND=vercel,daytona,e2b` (order / subset), `CODER_MEMORY=off`, `CODER_HARD_MAX_STEPS`,
`CODER_SANDBOX_TIMEOUT_MIN` (≤ 45 on Vercel Hobby), `CODER_SANDBOX_VCPUS`.

## Free-tier facts (checked 2026-10)

- Vercel Sandbox, Hobby: 5 active-CPU hours, 420 GB-h memory, 5,000 creations, 20 GB transfer per month; 10 concurrent; 45 min per session. Hard-capped (no bill).
- Daytona: free compute credit on sign-up, no card; per-second billing against the credit; refuses new sandboxes when it is used up.
- E2B Hobby: $0 plan with a one-time credit, no card; 1 h sessions, 20 concurrent.
- The scheduled-task dispatcher (`.github/workflows/coder-schedules.yml`) is a 5-minute curl on this public repository (public repos have no Actions minute quota); it does nothing until `CRON_SECRET` is set.

## Ready-made MCP servers (2026-10-24)
Connectors tab → "خوادم MCP جاهزة": one tap adds a remote Streamable-HTTP MCP server (catalog `MCP_PRESETS` in `src/lib/coderConnectors.ts`; the app sends only the preset id, the address comes from the catalog). Verified live on 2026-10-24 through our own client (`tools/list`): DeepWiki, Context7, Microsoft Learn, Cloudflare Docs, Hugging Face, Exa; GitHub MCP answers 401 without a token (token required). A custom server by URL stays under "Advanced". The agent calls them with `mcp_call` after the usual confirmation.

## ask_user
The agent can ask the user one question (`ask_user`); the task waits without a time limit and the next chat message (or terminal command) is the answer. `/stop` ends it like any task.
