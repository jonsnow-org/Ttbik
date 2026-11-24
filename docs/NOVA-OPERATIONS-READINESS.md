# Nova operations readiness and recovery

Last reviewed: 2026-11-24

This document records the safe operating model for Nova's own coder/media paths and the deployment fallback. It is a runbook, not proof that any external provider is currently healthy.

## Single-branch workflow

- The repository's default and sole continuing work branch is `claude/free-services-marketplace-h6rwk2`.
- Resume and reuse this exact branch across sessions. Do not create a new branch for each task, improvement, or conversation.
- Do not open routine pull requests from the default branch into itself. Keep focused commits on the same branch and preserve the existing confirmation gates for default-branch writes and deployments.
- Treat other branches as legacy or task-specific until their associated PRs and unique commits have been reviewed. Do not bulk-delete branches based only on age or name.
- A short-lived branch is allowed only when the owner explicitly requests a separate release/review track or the existing branch cannot safely be used and the owner approves the exception.

## Non-negotiable boundaries

- Keep Nova/Coder, Nova 2, Sham v1, and Sham v2 isolated. Do not share their memory, secrets, Studio processes, quotas, or mutable runtime state.
- A source file or environment-variable name proves implementation/configuration only. It does not prove a credential is valid, OAuth is complete, a deployment is live, or a capability works.
- Never print, copy into Git, or expose secret values. Inspect names and target environments only.
- Never test quota-consuming media generation, paid APIs, writes to external services, or production deployments as a health check.
- Prefer bounded retries with a deadline and an idempotency key for asynchronous jobs. Do not retry non-idempotent POST requests unless the provider contract explicitly supports it.

## Media orchestration: correct integration strategy

Nova's media capability is not one interchangeable engine. The current implementation describes distinct paths:
- Nova/Coder: its own Nova media Studio route, its own image weight, Arabic speech path, and video path.
- Sham v2 and old Sham: separate Studio and internal-generation routes.
- Photo-weight Studios: separately probed candidates.

Do not create an orchestrator that silently routes Nova requests into Sham or treats a healthy Studio status endpoint as proof that image, speech, and video generation all work.

A future `mediaOrchestrator` should be a thin coordinator over the existing model-owned adapters, with:
1. An explicit owner/model ID and media kind (image/audio/video).
2. Capability evidence per operation: configured, credential-present, provider-healthy, and generation-verified as separate states.
3. A provider adapter selected only from that model's allow-listed routes.
4. A bounded timeout/retry policy; retry only transient errors and only when the operation is safe/idempotent.
5. Durable job IDs and persisted states (queued/running/succeeded/failed/canceled), progress timestamps, and cancellation where supported.
6. Quota reservation before generation and settlement/refund on terminal failure.
7. Redacted structured telemetry: provider, model, job ID, duration, retry count, status class; never prompt secrets or tokens.
8. Tests proving model isolation, provider failure handling, duplicate submission handling, timeout behavior, and quota accounting.

Keep the existing `make_media` tool contract as the user-facing entry point until the adapters and callers have been mapped. Do not add a parallel tool that duplicates the current dispatch logic.

## Context and memory

- Keep the existing per-user persistent PostgreSQL memory and the current context-window trimming behavior.
- Store durable project decisions and verified architecture facts in Nova-owned notes/docs; do not copy chat transcripts or secrets.
- Summaries must preserve open tasks, branch/commit references, decisions, and uncertainty labels.
- Memory retrieval should report the actual retrieval method. Do not describe lexical/BM25 matching as vector or embedding search unless embeddings are implemented and tested.
- Keep Nova 2's separate memory and computer boundary intact.

## Self-correction and retries

- Retry only classified transient failures (429, selected 5xx, network reset/timeouts), with a finite attempt count, exponential backoff plus jitter, and a total deadline.
- Honor Retry-After within a configured cap.
- Do not retry validation/authentication/permission failures (400/401/403/404/422), quota exhaustion, or destructive/non-idempotent actions.
- Capture the first failure and each retry result; never swallow errors and report success after a failed terminal state.
- Use provider idempotency keys for job creation where supported.

## Visual verification

- Use the existing browser/desktop/screenshot path rather than committing a screenshot command that runs on every Git commit.
- Capture preview screenshots only after a successful preview deployment; compare phone and desktop viewports.
- Keep screenshots out of the repository unless they are intentional, reviewed test fixtures. Redact user data and secrets.

## Deployment and failover

The Cloudflare Worker `ttbik-gate` is configured as a reverse-proxy/failover layer with an Oracle primary origin and Vercel secondary origin. Its source contains bounded handling for transient gateway failures and a special case for Vercel HTTP 402. The Worker has a workers.dev subdomain enabled and a KV binding named `GATE`; these are configuration facts, not an end-to-end health proof.

Operational requirements:
- Keep the Cloudflare Worker as the stable ingress and verify its workers.dev/custom-domain route with a harmless GET.
- Probe Oracle and Vercel independently with a read-only health endpoint and record status, latency, and response identity.
- Treat Vercel 402 / `DEPLOYMENT_DISABLED` as a platform deployment restriction, not as an application 5xx. Do not loop retries against it.
- If Vercel remains blocked, Oracle may continue serving as the primary origin; keep the secondary configured but mark it unavailable until Vercel support resolves the block.
- Do not alter Worker routes, KV values, secrets, production aliases, or DNS during diagnosis without explicit approval.
- A deployment marked READY is not equivalent to a publicly reachable site. Verify the exact production alias from outside the provider API.

## Current account review (2026-11-24)

- The Vercel connector can read the `ttbik` project. The project API reports `live: false`.
- The latest recorded Vercel production deployment is READY but points to an older Git commit (`5ffd11c24f9247e55f0b24b1688c1a14d2f2cdc2`), not the current Nova fixes.
- The GitHub status context named `Vercel` is failing and points to Vercel's deployment-blocked knowledge page. A prior direct request to the production alias returned HTTP 402 with `DEPLOYMENT_DISABLED`.
- Cloudflare API access is authorized. The `ttbik-gate` Worker has a recent 100%-traffic deployment and bindings `GATE`, `PRIMARY_ORIGIN`, and `SECONDARY_ORIGIN`. A runtime HTTP health request could not be completed from the available diagnostic execution path; therefore the Worker is not marked end-to-end verified.
- Vercel environment-variable inventory shows that some required Nova connector settings are missing or empty. In particular, `CODER_TOKEN_KEY` and `CODER_VERCEL_CLIENT_SECRET` are present but empty in the production inventory. Other connector families (Google, Notion, Supabase, Slack, Discord, GitLab) do not have both production OAuth client values. This document intentionally does not record any secret values.
- No credentials should be pasted into chat. Configure or rotate them only in the provider's secure settings, then run a harmless OAuth/configuration check.

## Recovery checklist

1. Ask Vercel support to review the account/deployment block; include the deployment ID and the exact `DEPLOYMENT_DISABLED` / 402 symptom in their support portal.
2. Verify billing/account standing and deployment restrictions in the Vercel dashboard. Do not infer account-wide suspension from one blocked deployment.
3. Keep the Cloudflare gate and Oracle origin unchanged while checking Oracle's read-only health endpoint.
4. Restore required production environment values through the Vercel dashboard or secret manager; never through chat or Git.
5. Reconnect each OAuth provider through its own consent flow and verify callback success. Do not mark a connector connected merely because its client ID exists.
6. After Vercel confirms the restriction is cleared, deploy a preview from the current commit, run tests and browser checks, then request explicit approval before production promotion.
7. Verify the exact production alias, Worker ingress, health endpoints, and critical read-only API paths after release.

## Acceptance criteria for the next Nova improvement

- No changes to Sham or Nova 2.
- Existing model-specific media routes are mapped before adding an orchestrator.
- Unit tests cover the coordinator and provider failure matrix.
- Lint, typecheck, focused tests, build, and required CI all pass.
- A preview is reachable and visually checked at phone and desktop sizes.
- Production deployment and credential changes remain gated by explicit approval.
