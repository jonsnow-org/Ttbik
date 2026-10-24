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

## Capacity: more than one user (2026-10-24)
One Studio runs ONE generation at a time (2 free vCPU, ~5 tokens/s), so users queue behind each other. Capacity grows by replicas, each a free Studio running the same `app.py`:
- `ai-system/modelscope-coder/STUDIOS` lists the Studios (one per line). `deploy-modelscope-coder.yml` deploys every one of them on each push of `ai-system/modelscope-coder/**`, so replicas never drift from the primary. `workflow_dispatch` with `studio=<name>` deploys (or creates) a single one.
- The site sends a new completion to the first idle Studio (shortest queue, then failover) — `openCoderStudio.ts` — once the addresses are in `OPEN_CODER_STUDIO_URLS` (comma list, replicas only; the primary stays in `OPEN_CODER_STUDIO_URL`): `https://studio-novaai2026-coder-inference-server-2.api-inference.modelscope.net`. Then "move settings to Oracle" copies it to Oracle.
- Add a replica: add its name to STUDIOS, push, then add its address to `OPEN_CODER_STUDIO_URLS`. The free ModelScope account's Studio quota is the limit (the workflow stops with the platform's message if it refuses).

## Sub-agents: `delegate` (2026-10-24)
The model can hand up to 3 independent **read-only** investigations to sub-agents (`src/lib/coderAgents.ts`). Each is an ordinary run in its own state slot `a:<parentRunId>:<i>`, on OUR Studio model (whatever model the parent uses), so it gets the same legs, hand-offs, heartbeats and orphan recovery. Rules, all enforced by the runner:
- tools: only `github_repo_info/list_files/read_file/search_code/list_branches/list_prs/list_issues`, `web_search`, `fetch_page`, `memory_search`; anything else is answered "DENIED" (no writes, no VM, no `ask_user`, no nested `delegate`);
- at most 6 steps (the last one has no tools: the report is written then); quiet (nothing reaches the chat; its task row is archived so it stays out of the history);
- the report is left in the child's own state row (`agentResult`); the parent only **polls** those rows (no shared write, no race), then receives one tool message with the reports. Parent timeout 25 min (children are stopped); `/stop` and the app's ⏹ stop the children too.
- Speed: each child step costs what any Studio step costs (CPU, ~5 tok/s, one generation at a time per Studio), so 3 children on one Studio run one after another; replicas (`STUDIOS`) run them in parallel. That is the price of free hardware.
- `CODER_AGENTS=off` removes the tool.
Runs whose server was replaced mid-task are resumed by the every-minute tick (`claimOrphanTasks`, `coderTick.ts`).

## Connectors tab (2026-10-24)
One list of services (GitHub, Google Drive, Gmail, Notion, Vercel, Supabase, Slack, Discord) and the ready-made MCP catalog under it; the custom-MCP box stays under "advanced". Each service can be linked two ways, shown in the row's own panel:
- **sign-in** (OAuth) when the owner has created the service's OAuth app (`CODER_<SERVICE>_CLIENT_ID/SECRET`), and/or
- **a personal token** the user creates in their own account (`TOKEN_LINKS` in `coderConnectors.ts`): the page to create it and the steps are shown, the token is checked with the service before it is stored (encrypted, like OAuth tokens), `connector_api` uses it (Discord with the `Bot` scheme). GitHub's token option lives here too (the old separate box is gone); GitHub's official MCP preset was removed as a duplicate.
- Google (Drive, Gmail) has no personal-token form: it shows **«setup»** to the owner only, with the redirect URI and variable names; users do not see it until sign-in is configured. There is no «soon» label anywhere.
- Op `connector_link {id, token}`; `connectors` returns per service `{status: connected|available|setup, oauth, token?, setup? (owner only)}`.

### Agents v2 (workers, 2026-10-24)
- One run starts up to **5 agents** at once (`AGENT_MAX`); each **worker** agent may start **2 read-only helpers** (`SUB_AGENT_MAX`); helpers start nothing (`AGENT_MAX_DEPTH` = 2). Roles: `reader` (read-only), `worker` (all tools, 12 steps), `tester` (one per call), `sham` (owner only, an evaluation tool: it does not train Sham).
- A worker has the parent's tools and the parent's permission settings. Every consequential call goes through the same `evaluateCall` as the main assistant's, so delete / merge / main-branch writes / settings / connected-service writes **ask the user** (a Telegram message "🤖 وكيل «…» يطلب إذنك" with ✅ / ❌ / ✅ for the rest, and the same card in the Mini App). A worker cannot ask free questions (`ask_user`).
- New permission categories `edit` (write files, create branches / PRs / issues / comments) and `merge` (merge ANY PR) are opt-in: they ask only when the user's rule says "ask". Agents have no settings of their own: they use the parent's rules (and what the user allowed for the task) exactly.
- The helpers an agent starts (depth 2, max 2, read-only) run PRESET jobs: the agent gives `helper` + `arg` and the server writes the instruction from a template (`HELPERS` in `coderAgents.ts`): repo_scout, repo_reader, code_finder, web_researcher, page_reader, verifier, issue_digest, and runner (the only one with a VM, one per call, never writes to GitHub). An unknown job falls back to a free read-only task.
- The model server runs one generation per Studio (`-np 1`), so the real parallelism is the number of Studios; more agents than Studios queue.
- With 2+ Studios a research report is written in parallel: one section per Studio from the same sources (`coderParallel.ts`, `CODER_PARALLEL_REPORT=off` disables); a conversation goes back to the Studio that holds its prompt cache.
