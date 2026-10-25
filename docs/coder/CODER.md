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
- Agent reports are never cut: an agent writes as much as its job needs and the parent receives every report exactly as written (`composeResults` only organises them). Only when ALL reports together would not fit the model's context (`CODER_AGENT_REPORTS_HARD`, default 60,000 characters) does the system condense the longest ones with the model (`fitReports`), keeping every name / number and NOT DONE, and marks them; a failed condensing leaves the report as it was.
- One context size for everything (`coderContext.ts`): the Studios run llama.cpp with `-c 65536` (default in `app.py`; measured peak memory on the 8 GB box: 32k 5.07 GB, 64k 6.07 GB, 96k 7.06 GB, 128k 8.06 GB, so 64k is the safe maximum). The bot learns the size from each Studio's status (`ctx`, the smallest wins) and derives the history window, the segment checkpoint and the agent-reports limit from it; `CODER_CTX_TOKENS` forces a value. A longer context costs reading time: the first read of a long history is ~40 tokens/s, then the Studio's prompt cache makes later steps cheap.

## Quick lane and slow first read (2026-10-25)
The Studios read a prompt at ~30-45 tokens/s and write ~4 tokens/s (2 CPU threads), so the first step of a long conversation is silent for minutes.
- **Quick lane** (`frontAck` in `coderSections.ts`): when a new task starts, a second tiny call (system line + the request only, max 70 tokens) goes to a Studio no conversation used in the last 15 minutes (`fresh` in `coderCall`), and its one-line reaction is sent as `🤖 …` (Telegram) or a terminal event. It never answers the task, is dropped if the real answer already started, and is skipped with a single Studio. `CODER_FRONT_ACK=0` turns it off.
- **Reading progress**: the Studio streams llama.cpp `prompt_progress`; the task card shows «النموذج يقرأ المهمة… %», and any progress counts as life for the stall watchdog. Before the first progress, a long prompt gets `promptEst / 25 tok/s × 1.3 + 60 s` (max 20 min) instead of 3 minutes.
- **Repeated requests** (the same user text re-sent with no answer between) are read once (`collapseRepeats`).
- The `🧠 إرسال الخطوة` task event now shows the split of the prompt (instructions + conversation).
- **History window is capped at 24,000 characters** (`HISTORY_CAP_CHARS`, `CODER_HISTORY_CHARS` overrides) and is no longer raised with the 64k context. The raise to 64k had doubled it to 80,000 characters (~25k tokens ≈ 10+ minutes of silent reading on a cold Studio, and the same again at every shift of the window). The 64k context stays free for long tool results, agent reports and segments.
- **Quiet work** (memory extraction, thread titles) now runs only on a Studio no conversation used in the last 15 minutes (`fresh`), so it never evicts a conversation's prompt cache or queues ahead of a user's request.
- **The start of the prompt never changes** (measured with `nova-live-probe.yml cache=1`: same start + 2 new messages = 4 s, 23 tokens read; ONE changed line in the system message = the whole 3.4k-token prompt read again, 77 s). The system message is now the same text every time (no date, no notes, no memories); those ride on the task's own request message as a `ctx` field stamped once per task (`ctxStamped`). A new message therefore reads only itself when the conversation's Studio still holds its cache, and a request goes back to that Studio when it has at most one job ahead.
- **Engineer review (2026-10-25) follow-ups**: the Studio's worker no longer sits on a cancelled / abandoned job while the model is loading or in error (it re-checks every 2 s); a Studio whose model server is in `error` makes the bot resend the step to another Studio at once (max 2 times) instead of waiting out the 3-minute stall limit. Known and accepted: the job queue lives in the Studio process memory (a restart loses a running generation; the bot's orphan sweeper re-sends the step), one generation at a time per Studio, ~4 tokens/s on the free 2-vCPU box.

## Parallel independent reads (engineer review, 2026-10-25)
Up to 4 consecutive read-only GitHub calls from one model step (read file / list files / search code / branches / PRs / issues) run together
(`PAR_READ` in `coderSections.ts`), each one still passing the role check, the repeat guard and the permission policy; writes and anything that needs
confirmation stay sequential. Off with `CODER_PARALLEL_TOOLS=off`. Not adopted from the review, on purpose: a pre-planner / staged "adaptive engine"
(the owner's rule: the request goes to the model at once, no stages), a repo index and composite tools (separate, measured work first), speculative decoding
(no spare RAM/CPU on 2 vCPU).

## Composite reads and the speculative-decoding switch (2026-10-25)
- `github_repo_scan` (facts + top-level folders/files + README start + main manifest) and `github_read_files` (up to 4 files) answer in one model step what took 4-6; their inner GitHub calls run together. Both are also allowed for sub-agents and in the parallel-read batch.
- `CODER_SPEC` (Studio env, empty = off): extra llama-server flags for speculative decoding, e.g. `--spec-type ngram-simple` (no draft model, no extra RAM). If the server does not come up with them, the supervisor restarts it without them by itself. Not enabled anywhere: run `nova-flag-check` to see which spec flags build b11757 accepts, then measure on ONE Studio before enabling.
- Not built, on purpose: a pre-task planner/stage (a changed tool list at task start would also break the prewarmed prefix), a persistent repo index (measure `github_repo_scan` first).

## Sham rule (owner's standing goal, restated 2026-10-25)
When Sham's training is finished it must meet NO limit of any kind (speed, agents, generation, tools). Sham was built from scratch to avoid the mistakes of other models and is
meant to be advanced despite its small size. So: every invention, tool or smart method added to Nova is also added to Sham, adapted to Sham's structure; and every ceiling
that exists only because today's Sham is small must be a SETTING, never a constant.
- Limits found (2026-10-25) and now settings (defaults = today's behaviour): Studio answer cap 200 tokens (`SHAM_MAX_NEW_TOKENS`, in `modelscope-sham/app.py`), prompt window 384 tokens
  (`SHAM_MAX_PROMPT_TOKENS`, `sham_studio_chat.py`), Telegram reply 80 tokens (`SHAM_REPLY_TOKENS`), inside Nova's engine: history turns/chars, sources, prompt size
  (`SHAM_HISTORY_TURNS`, `SHAM_TURN_CHARS`, `SHAM_SOURCES_CHARS`, `SHAM_PROMPT_CHARS`, `SHAM_LIM` in `coderProvider.ts`). `SHAM_LIMITS=open` lifts all of them at once, no code change.
- Still real limits, not settings: the model's own `max_seq_len` (2048 in the config; prompt + answer must fit), the 60 s Telegram webhook of the one-step path (long Sham work goes through
  `sham_loop`, Nova's engine, which has no such ceiling), and Sham has no OpenAI-style tool calling inside the engine (the engine does the searching, retrying, long tasks for it).
  When a trained Sham learns the call format, switch the engine's Sham path from "bare words" to tool schemas (`shamAsModel` in `coderProvider.ts`) — nothing else needs to change.

## Sham gets Nova's tools (2026-10-25)
Nova's tool families (GitHub read/write/PR/CI/workflows, `github_repo_scan`/`github_read_files`, the private VM / terminal `sandbox_clone/exec/wait/read_file/write_file`, `web_search/fetch_page/deep_research`,
memory, schedules, `delegate` sub-agents, `ask_user`, `connector_api`, `mcp_list_tools/mcp_call` = every connected service such as Vercel / Supabase / Cloudflare) all live in Nova's engine, not in the model.
Sham reaches them through the engine as TEXT (`src/lib/shamTools.ts`), because its vocabulary is fixed and it has no JSON tool calling:
the engine shows the LOADED tools (Nova's groups, short list) and the call format; Sham writes `<tool_call>{"name": "...", "arguments": {...}}</tool_call>`; the engine runs it with the same permissions,
sandbox and stall guard as a Nova call and shows the result next turn. Switch: `SHAM_TOOLS=on` (or `SHAM_LIMITS=open`); `SHAM_TOOLS=off` always wins; off by default so an untrained Sham is not shown a format it cannot follow.
Teaching it: `ai-system/colab/sham_small/sham_tools_data.py` builds examples (calls learned, results masked, answers learned) from Nova lessons of ANY kind plus a synthetic catalog covering every family;
`SHAM_TOOLS_MIX` (default 0) is the share in a training mix — the training pipeline has not been wired to it yet.
Compared with Claude's own toolset (the session that builds this): terminal = `sandbox_exec`; file read/write = `sandbox_read_file/write_file`; search = `github_search_code` + `grep` in the VM; web = `web_search/fetch_page`;
sub-agents = `delegate`; MCP services = `mcp_call`/`connector_api`. Gaps: an exact-replace file EDIT tool (Nova rewrites whole files), a dedicated glob tool (use `ls`/`find` in the VM), image viewing.

## A Studio queue that does not move (2026-10-25, measured on a live task)
A task waited 3+ minutes at "queued behind 1" on its home Studio while the other four were idle (status probe: Studio 1 queue 2, the rest 0), then the step was sent again. Now, when the job sits in a queue
(`queue_pos > 0`, nothing read yet) and does not move for `CODER_QUEUE_MOVE_MS` (default 25 s), it is cancelled and sent to an idle Studio (`avoidHome`, up to 3 times per step); the home mapping follows the new Studio.
Also seen in that task: deeper thinking was ON (step 1 on a 1.2k-token prompt took ~2 min); the read-progress % moves in coarse jumps (it stayed at 59% for 40+ s on a 3.7k-token prompt).
Over the last 24 h: 19 runs, 98 step sends, only 3 runs with a resend — a double read is not the normal path.

## Thinking stays ON in all three modes (owner, 2026-10-25)
The goal is that fast / balanced / precise all work with deeper thinking; "turn thinking off" is not the answer. The accuracy mode now sets how long a thought may be (`thinkCapFor` in `coderSections.ts`,
sent as `think="1:<chars>"`, read by the Studio's `_think_flag`): fast 500 chars, balanced 1200 (the default, sent as plain "1" so an older Studio still thinks), precise 3000;
`CODER_THINK_CAP_FAST/BALANCED/PRECISE` override. A Studio that is not redeployed yet treats "1:500"/"1:3000" as thinking OFF (it only reads the plain "1"), so fast and precise take effect after the next Studio deploy.
Sampling temperature and the accuracy prompt line were already per mode. Measured on balanced (live task 2026-10-25): ~30-50 s of thought per step.

## No automatic mode picking (owner, 2026-10-25)
The mode (fast / balanced / precise) is the user's choice. A keyword-based "simple request -> fast" switch was built and REMOVED the same day: the owner does not want code deciding for the model.

## Where 13 minutes went on a live task (2026-10-25, "analyse the Nova project"), and what changed
Measured from the task log: step 1 ~1 min (thinking), step 2 ~1.5 min, a file read grew the context, the Studio then had to read ~7.7k real tokens from zero (3 min), then ~4 min WRITING A SUMMARY for the next segment
(a model call whose only output was a summary), plus 429 "Request limit exceeded" bursts from the hub and two worker cut-offs caused by our own pushes (Oracle swaps the containers).
- The segment summary is now written by the harness (`fallbackSummary`, no model call); the model's own: `CODER_SEGMENT_MODEL_SUMMARY=on`.
- `github_repo_scan` / `github_read_files` return less per call (files 3000 chars, README 2000, manifests 1200; `CODER_READ_FILES_CHARS`): one big read costs minutes of prefill on CPU, and Arabic is ~2.4x more tokens than the char estimate.
- A 429 is retried after at least 10 s (it used to be hit again within 1-2 s).
- The Telegram progress card is live (`refreshCard`): tool steps plus the model's state (reading %, thinking, writing, queue) and the time of the last update, edited in place every ~5 s (`CODER_CARD_REFRESH_MS`).
Still true: a ~10k-token context read from zero is ~4-5 min on these 2 vCPU Studios; the only real fix is to keep the prefix stable on the same Studio (done) and the context small.

## Tool audit and additions (2026-10-25)
Compared with the tools the building session itself uses (shell, read / write / exact-replace edit, grep / glob, web, sub-agents, GitHub incl. CI logs / PR conversation / commits, MCP services), Nova lacked: an exact-replace edit
(it rewrote whole files), file search in the VM, CI failure logs, a PR's conversation, commit history, and compare. Added: `sandbox_edit_file`, `sandbox_search` (VM; group `computer`), `github_ci_logs`, `github_pr_info`, `github_commits`,
`github_compare` (read-only: also allowed for sub-agents and in the parallel-read batch), `github_edit_file` (a commit; same permission policy as `github_write_files`). Still not there, on purpose or for later: a generic HTTP request tool
(needs an SSRF-safe design; `connector_api` / `mcp_call` cover linked services), image viewing, a notebook tool. The tool list changed, so each Studio reads the first prompt once from zero after this ships.
How the model decides how long to think (checked in code and training): today Nova is the base Qwen3.5-4B (Nova 1 has not trained yet); the thought length is the base model's own, the harness only caps it per mode (500 / 1200 / 3000 chars)
and the Studio re-asks without thinking if a thought ends empty. Nova 1's data has 12% reasoning traces (OpenCodeReasoning) but no examples that teach "short question -> answer without a long thought"; adding such examples to the training mix is the way to make the MODEL decide it.
