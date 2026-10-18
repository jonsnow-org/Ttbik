# Athar inside the media bot's mini app (2026-10-18)

**Analysis.** The media mini app (`src/app/mini-app/page.tsx`) is a light sky-blue feed of shared downloads with tabs (trending, following, audio, me), an ad slot at the top and an Adsterra card before every 5th post, plus a "me" tab with usage, rewards and the premium upgrade. Its people come to watch and save clips, so a sales panel or a modal would be noise. What fits is a *native card in the feed*, tied to the post, and one fuller card where people already look at themselves.

**Decision.**
| Where | What | Why |
|---|---|---|
| In the feed, at posts 5, 15, 25 ... (the ad keeps 10, 20 ...) | «يوم هذا المقطع في أثر»: the real token art of the day the clip was shared, which kinds are still free, tap opens that day in Athar | Native, relevant to the post, replaces an ad slot rather than adding clutter; falls back to the usual ad when Athar does not answer |
| «ملفي» tab, under «استخدامي» | Full card: today's token, free kinds, «افتح هذا اليوم», «📅 اختر يومك» picker (birthday, anniversary), «تعرّف على أثر» | Self-oriented place; the picker is where a personal date makes sense |
| Not done on purpose | No modal, no top banner, no push from the bot | The page already carries two ad slots; an extra interruption costs more than it earns |

**How it works.** `GET /api/media-athar?date=YYYY-MM-DD` (default today): public, read-only, 60 requests a minute per IP, answers cached 10 minutes per day; code in `src/lib/atharDay.ts` (shared with the match app). Cards live in `src/components/AtharMediaCard.tsx`. The feed card requests only when it scrolls near the screen. Taps are counted as the `athar` event in `/api/media-stats`. Payment stays inside Athar's own app (TonConnect); the cards carry no price, return or investment wording.

**Switch off:** `MEDIA_ENABLE_ATHAR=0` (Vercel env), redeploy. Everything hides by itself when Athar's public API does not answer.
