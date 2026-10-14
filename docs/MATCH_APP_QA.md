# Match mini-app — local QA pass (2026-10-14)

Environment: `bash scripts/qa/env.sh up` (local Postgres :54329, fake Telegram API :54400 via
`scripts/qa/intercept.cjs`, `next start` :3100, seeded fake users). Never touches prod DB or the real token.
Spec: `e2e/match-app.spec.ts` (Playwright, 390x844, mocked `Telegram.WebApp`, signed initData,
simulated webhooks). NOT run in CI. Screenshots: `/workspace/qa/shots/`, captured issues: `/workspace/qa/issues.json`.

## Bugs

| # | Screen | Steps | Cause | Fix | Status |
|---|--------|-------|-------|-----|--------|
| 1 | Admin dashboard | Switch sections quickly (Overview → Reports) | Slower response of the previous section rendered under the new one (`r.reporter.name` of undefined → page crash) | Request sequence guard + data tagged with its section (`__sec`) | Fixed |
| 2 | Admin dashboard | Leave Overview | Section badges (pending counts) disappeared — they were read from the current section's data | Badges kept in their own state | Fixed |
| 3 | Anon chat | Two app users press 🔀 within ~1 s | App path has no search animation, so the first searcher falls back to an AI partner immediately (FAKE threshold 100) — real app users rarely meet each other | Proposed: give app searches the same ~6 s waiting window the bot animation gives before the fake fallback | **REVIEW — open** (touches shared matching; bot behavior must stay unchanged) |
| 4 | QA env | `env.sh up` never returned | Background processes inherited the pipe | `setsid … < /dev/null` | Fixed |

## Verified OK
Boot/outside-Telegram screen, all 4 tabs (+ admin tab only for admin), bad initData → 401, non-admin admin_* → 403,
AI interlocutor chat stays in the app (no bot pushes), exit-reason sheet, app ↔ bot user via webhook,
discovery swipes/like/super/proposal/match modal, chats tab + compliment, profile edit/criteria/privacy,
every upgrade, insufficient balance, Stars invoice (`openInvoice`), every admin section and action, inline query.

## Not tested
Real Telegram clients/devices, real Stars/TON/crypto payments, photo upload from device, Supabase realtime (off).
Full 15-message contact exchange + report/block between two real app users is blocked by bug #3.
