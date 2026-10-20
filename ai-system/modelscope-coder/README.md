# coder — open coding model on its own ModelScope Studio

The commercial daily-use coding model, **separate from Sham** (Sham's Studio, notebooks, datasets and code are not touched by anything here).

| | |
|---|---|
| Model | `unsloth/Qwen3.5-4B-GGUF` → `Qwen3.5-4B-Q4_K_M.gguf` (2.74 GB, Apache-2.0); fallback `Qwen/Qwen2.5-Coder-7B-Instruct-GGUF` → `qwen2.5-coder-7b-instruct-q4_k_m.gguf` (4.68 GB, Apache-2.0). Both verified on modelscope.cn 2026-10-21. |
| Runtime | llama.cpp `llama-server`, release **b11757** (CPU, ubuntu-x64; needs glibc ≥ 2.34 → fine on the Studio's Ubuntu 22.04), sha256 pinned in `app.py` and in the workflow. |
| Context | `-c 32768` (env `CODER_CTX`, never below 8192). No answer-length cap (`max_tokens 0`, `-n -1`). |
| API | Gradio call protocol, same as Sham's Studio: `chat`, `job_result`, `cancel`, `status` (see the docstring of `app.py`). |
| Queue | one generation at a time, FIFO, nobody refused; long answers continue as a job the bot polls. |
| Studio | `novaai2026/coder-inference-server` (private, free `platform/2v-cpu-8g-mem` — the only free tier the API offered on 2026-10-21; Gradio 6.29.1 from the platform). API host `https://studio-novaai2026-coder-inference-server.api-inference.modelscope.net`, page https://www.modelscope.cn/studios/novaai2026/coder-inference-server, created and updated by `.github/workflows/deploy-modelscope-coder.yml` with the existing `MODELSCOPE_TOKEN` secret. The workflow carries the llama.cpp tarball because the Studio cannot reach github.com. |

Measured on the box (2 threads, like the free 2 vCPU Studio): load ≈ 4 s from disk, ≈ 4.6–5 tokens/s generation, native tool calls work (`--jinja`).
A full harness run (read a file on GitHub → answer → try a push to `main` → stopped at the confirmation button) took ≈ 2 min 17 s.

`combined_app.py` = design only, for an account limited to one Studio: Sham + coder in one app with `coder_` api names and 1 CPU thread for the
coder. It is **not** deployed; it would replace the Studio entry file, so the owner decides first.

Bot side: `src/lib/openCoderStudio.ts` (client), `src/lib/coderAgent.ts` (tools + the only guardrail), `src/lib/coderSections.ts` (/mode,
job/detach loop), `src/app/api/coder/continue/route.ts` (next leg of a long run).

## Bot side: permissions, loops, settings

**Two tiers** (`src/lib/coderAuth.ts`, `src/lib/coderAgent.ts` → `classifyCall` / `guardCall`):

| | runs without asking | waits for ✅/❌ |
|---|---|---|
| **owner** (`SUPER_ADMIN_TELEGRAM_ID`, `TELEGRAM_ADMIN_CHAT_ID`; token `CODER_GITHUB_TOKEN`) | everything else (settings, collaborators, releases, deploy workflows, force-push to feature branches, secrets via `github_api`) | any delete; push / merge into main or the default branch; a workflow that commits/pushes |
| **user** (only their own linked token, never the owner's) | thinking, planning, reading, searching, CI checks, test-only workflows, branches, commits/pushes to feature branches, PRs, draft releases | any delete; push/merge into main/default/protected; force-push / history rewrite; deploy/publish workflows or ones that write (the workflow file is read to decide); repo settings, secrets, collaborators; publishing a release |

Per-user linking (later, Mini App): verify the user with `verifyTelegramInitData`, run the provider's OAuth/device flow, call
`saveConnection(chatId, "github", token, login)`. Stored AES-256-GCM encrypted in `coder_connections` (key `CODER_TOKEN_KEY`).

**No pause — loop recovery instead** (`src/lib/coderStall.ts`): the same action+args 3× (`CODER_STALL_REPEAT`), the same output/error 3×,
the same reasoning text 3×, or `CODER_STALL_NO_PROGRESS` (12) steps with nothing new → a reflection + new-plan step is injected; from the
2nd loop the files being worked on are re-read and the model thinks harder (thinking on, wider sampling); from the 3rd it re-plans from
scratch. A 4th identical call is not executed again (its earlier result is returned). CI polling that still shows "in progress" is waiting,
not looping (the loop waits `CODER_CI_WAIT_MS`, 20 s). Studio hiccups are retried (5×, smaller context on a job error).
Every loop is logged in `coder_stall_log` (run id, chat hash, step, pattern, level, detail) + Vercel logs `[coder-stall]`; the owner sees
the latest in the Mini App (Settings → logged loops).

**Hard ceiling**: `CODER_HARD_MAX_STEPS` (default **400**, minimum 50) counts model steps **since the last real progress** (a new successful
action or a changed CI result), not total steps — a stall safety net only. Reaching it ends the task with a message and a `hard_ceiling` log
row; it is not a question to the user.

**Segments (long tasks)**: when a running task's context passes `CODER_SEGMENT_CHARS` (default 75% of `CODER_HISTORY_CHARS`), the model
writes a progress summary (GOAL / PLAN / DONE / REMAINING / KEY FILES / DECISIONS / NEXT STEP; the harness writes one itself if the model's
is unusable), it is stored in `coder_task_memory` and the task timeline, the context is reset to request + summary, and the task continues
in the background in the next segment. The user gets a one-line notice in Telegram and the final result as usual.

**Long-term memory** (`src/lib/coderMemory.ts`, table `coder_memories`): per user (keyed by the user's chat key; no query crosses
users), kind preference / fact / decision, scope global or one repo, source task. At the end of each task (and on "new conversation") the
explicit "remember…/تذكّر…" lines are saved and the free coder model proposes durable facts from the user's words and the coder's replies only
(never tool output, so fetched pages cannot plant memories; credentials are dropped). Saving de-duplicates (same text → refreshed) and a fact on
the same subject replaces the older one. At the start of a task the most relevant memories (keyword + recency + repo scope, preferences always)
go into the system prompt. Tools: `memory_save`, `memory_search`, `memory_forget` (a delete → follows the delete confirmation policy).
Users view, add, edit and delete them in the Mini App (Memory tab). `CODER_MEMORY=off` disables extraction.

**Bot commands**: management lives in the Mini App (persistent menu button + inline web_app button). The chat keeps `/start` and `/stop`;
other commands (/mode, /perms, /schedule, /memory, /think, /status, …) answer with a button that opens the app on the right tab.

Env: `OPEN_CODER_STUDIO_URL` (required), `MODELSCOPE_API_TOKEN` / `OPEN_CODER_STUDIO_TOKEN`, `CODER_GITHUB_TOKEN`, `CODER_TOKEN_KEY` (for
linked user tokens), optional `CODER_HARD_MAX_STEPS`, `CODER_STALL_REPEAT`, `CODER_STALL_NO_PROGRESS`, `CODER_CI_WAIT_MS`, `CODER_HISTORY_CHARS`, `CODER_SEGMENT_CHARS`,
`CODER_DEFAULT_MODE`, `CODER_SELF_URL`, `OPEN_CODER_API_PREFIX`.
