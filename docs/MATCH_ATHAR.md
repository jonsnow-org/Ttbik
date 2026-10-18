# Athar promotion inside the match Mini App (step 3, 2026-10-14)

**ON by default since 2026-10-14 (owner approved).** Switch off: set `MATCH_ENABLE_ATHAR=0` in the site's environment
(Vercel → Project → Settings → Environment Variables → Production) and redeploy. Every Athar card still auto-hides when
Athar's public `/api/date/0` does not answer (checked every 10 min, 3 s timeout).
Optional: `NEXT_PUBLIC_ATHAR_BOT_URL` (default `https://t.me/AtharDaysBot`, same as Athar's own fallback) and
`NEXT_PUBLIC_ATHAR_URL` (Athar web, already used by the Athar bot).

## What the app shows (only when the flag is on AND Athar's public `/api/date/0` answers; checked every 10 min)
| Where | Card | Link |
|---|---|---|
| «إنه توافق!» modal | 🕰 يومكم في أثر — today's date | `ATHAR_URL/date?i=<index>&lang=ar` |
| Chats tab, after a contact exchange or an accepted 💍 | 🎁 أهدِ شريكك تاريخ أول محادثة / ذكرى يوم القبول (dismissable) | date of the first chat / acceptance |
| Chats tab, mutual match ≥ 30 days | 🗓 مرّ شهر على تعارفكما | mutual-like date |
| Profile section | 🎂 تاريخ ميلادك في أثر (1950-2049, not stored) + «تعرّف على أثر» | chosen date / Athar bot |
| 💎 Showcase (2026-10-18, live): Chats tab top (full card), Me tab top (slim row), Profile section (full card with date picker) | The real token art of today's (or the picked) day from `/api/athar/img`, which kinds are still free (`/api/date/<i>`, cached 10 min; unknown = no claim), «افتح هذا اليوم» + «📅 اختر يومك» picker that updates the card in place | the day's own page `ATHAR_URL/date?i=<index>&lang=ar`; TonConnect + TON payment stay inside Athar |
| Shared match page `/match-share/<token>` | 🕰 ذكرى هذا اليوم في أثر | match date |

Deep-link format verified, not guessed: Athar's birthday reminder (`src/app/api/cron/athar-birthdays/route.ts`) opens
`${ATHAR_URL}/date?i=${index}&lang=…`, index = `athar/lib/rules.indexOf(y,m,d)` (1950-01-01 = 0 … 2049-12-31 = 36524).
The Athar bot's `/start` ignores any payload (`atharBotLogic.ts`, `cmd === "start"`), so the bot link carries no date.
No payments, wallet, prices or investment wording in the match app — gift / memory wording only.

## Cross referral
- Match → Athar: «تعرّف على أثر» link + every Athar card (clicks counted as funnel event `athar_click`).
- Athar → match: the match bot now accepts `/start ath_<inviterTelegramId>` exactly like `ref_<id>` (same
  `referredBy`, same existing reward: when the new member's profile is approved, the inviter gets the free 24 h boost
  via `grantReferralReward`). Arrivals are counted as `athar_arrival` in the admin funnel (📈 التحويل).

## Note for the Athar engineer (NOT done here — Athar code untouched)
1. To send people to the match bot, add a share/menu button in the Athar bot pointing to
   `https://t.me/<MatchBotUsername>?start=ath_<the user's Telegram id>` (Arabic text suggestion:
   «💞 توافق — تعارف جادّ بهدف الزواج»). Nothing else is needed on the match side.
2. Optional: if Athar ever wants `t.me/AtharDaysBot?start=d_<index>` to open a date directly, its `/start` handler would
   need to read the payload; until then the match app links to the Athar web page above.

## Privacy of the shared match page
`/match-share/<random token>` shows only «تطابق جديد على توافق», the date, a link to the bot and (flag on) the Athar
date card. No names, ids, photos, ages or countries; `noindex`. Created only by one of the two members of a mutual
match (rate limited 10/h).

## Payments
The match app contains no wallet or payment code for Athar. Users who buy a day do it inside Athar's own web app
(TonConnect, TON — Athar's existing flow). Telegram Stars for Athar are NOT active; see
docs/SPEC_FOR_ATHAR_STARS.md and docs/FOR_ATHAR_CREATOR_REVIEW_stars_payments.md for the engineer.


## Showcase (2026-10-18)
API action `athar_day` ({date?: YYYY-MM-DD}, default today) returns `{index,label,link,img,kinds[{name,free}],anyFree}`; `src/lib/match/athar.ts: atharDay`. Wording stays gift/memory only: no price, no return, no investment claim. Hidden with the rest of Athar when the flag is off or Athar does not answer.
