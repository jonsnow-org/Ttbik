# The terminal (الطرفية): one background executor for every model

**What it is.** The terminal is the background execution environment. Work that is long (agents, code, research) or heavy (pictures, video, speech) runs there,
independent of any connection. The Telegram chat and the Mini App are only front-ends: they start work, read its progress and receive its result. This exists
because long tasks and media used to cut the connection, and because Telegram limits message length and size.

**One system, many engines.** The shell (Home, Chats, Schedule, Settings, Terminal, connectors), the chat store, the task table, the event log and the
reconnect layer are shared infrastructure. Nova, Sham and Sham v2 are engines behind it. Nova and Sham v2 do not import each other and keep their own Studios;
only the neutral shell modules (`coderApp.ts`, `coderChats.ts`, `coderTasks.ts`, `novaBotLogic.ts`) know several engines.

## The design (what is implemented)

| Piece | Where | Rule |
|---|---|---|
| Durable job table | `coder_tasks` (`coderTasks.ts`) | one row per run, `run_id` is the idempotent id (`taskStart` is `ON CONFLICT DO NOTHING`); status `running / waiting / done / failed / stopped` |
| Resumable event log | `coder_task_events` | append-only, numeric `id`; the app and the chat poll with a **cursor** (`events` op: `after=<last id>`); a dropped connection resumes with nothing lost or repeated (tested) |
| Heartbeat + lease | `taskTouch`, every event, `updated_at` | a run is alive while its heartbeat is fresh |
| Stale reaper | `reapStaleTasks` | heartbeat silent 10 min (run older than 15 min) -> `failed`; hard cap by start time: Sham 45 min, others 6 h; `waiting` is never reaped. Runs before every list the app reads, so "running now" cannot keep dead runs |
| Orphan resume | `claimOrphanTasks` (`coderTick.ts`) | a Nova run whose worker died is claimed atomically and resumed from its saved state; **never** re-bumped once it started > 30 min ago (that bump made dead runs look alive for days) |
| Commands from the chat | `handleCoderSections` | a message during a run joins the run's inbox; `/stop` ends it (and cancels the Studio job); a question from the agent (`ask_user`) is answered by the next message |
| Commands from the app | `appOp` | `stop`, `task_stop` (one), `stop_all` (every running task), `task_delete`, `tasks_clear`, `thread_*`, `chat_*` |
| Reports to the chat | `send`, `sendShamReply` | chunks at line ends, each under 4096; a Sham report beyond ~24 000 characters is sent whole as `report.txt`; nothing is cut |
| Media | `mediaFastLane` (Nova), `shamMediaFastLane` (Sham / Sham v2) | a clear "make a picture / video of X" is recognised **before** the model (`coderMediaFast.ts`), runs in the background as a task, goes quota -> Studio -> `vetMedia` -> photo/video with **no caption** -> quota handed back on failure; the result is delivered even if the webhook call that started it has long returned |
| One shared view | `/api/coder/terminal`, `threads`/`tasks` ops | one task list and one terminal for all models (no per-model filtering); the Chats tab has one list of every conversation of every model, each tagged with its model, any chat can be continued by selecting its model |
| Guard against raw plans | `looksLikeToolPlan` (`shamDeliver`) | a final answer that is only a tool plan ("… ← sandbox_exec ثم …") is never delivered; the user gets an honest failure line |

## Model-provider interface (shared)

A model engine plugs in by providing: a way to **start** a run (creates the task row with its `run_id`), a **step/leg** executor that appends events and updates the
heartbeat, a **deliver** function (chunked text, photo, video, document), and its own **settings** (thinking, speed, media), visibility and quotas. Everything else is
shared. Today Nova's engine is `coderSections.ts` (`drive`, `driveLoop`), Sham's is `novaBotLogic.ts` (`shamAgentAndSend`, `continueShamRun`, legs via `/api/sham/continue`).

## Not done yet (honest list)
- A media task started on a worker that dies mid-way is not resumed (it is closed by the reaper after the heartbeat lease); the user must resend.
- Per-user concurrency limits and priority queues exist for Nova's Studio queue (Pro/owner first) but not as a shared executor setting.
- SSE for the event log: polling with a cursor is used (works through every proxy); SSE would only lower latency.
- Sham v1 and Sham v2 share the `sham-` run prefix: their tasks are distinguishable only by title, not by a model tag.
