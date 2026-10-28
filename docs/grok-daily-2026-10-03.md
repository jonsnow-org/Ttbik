🤖 GROK: 2026-10-03 daily check (news/events/articles/digest/home card/telegram cron)

Live https://ttbik.vercel.app — / /news /events /articles /digest all HTTP 200. No 500.

Fix in ONE patch on the production branch only (do not touch media-bot / space / mini-app / bot builder):

1) Title duplication: document title is "… | سوق تولز | سوق تولز" on /news /events /articles /digest. Layout template already appends the brand. Page metadata title should not include سوق تولز again. Align og:title with the cleaned title.

2) Event of the day is stale. Today is 2026-10-03. Featured event is International Day of Non-Violence dated 2026-10-02 (latestEvent() = EVENT_ITEMS[0], not date match). Add a dated item for 3 Oct (e.g. World Habitat Day is first Monday of October = 5 Oct 2026, so not today) or pick a documented 3 Oct observance with sources, image, FAQ. latestEvent() should prefer dateIso === today (Asia/Riyadh), else nearest upcoming, else most recent past — never silently show yesterday as حدث اليوم.

3) /digest has 0 images. Reuse event/article cover and the top news cluster image. خبر اليوم on digest is still Crew-13 while the live cluster is FlyDubai copilot (6 sources, ~19 min). Digest news-of-day should be the top multi-source cluster, not a static editorial item.

4) News cards: empty alt; one img src is an mp4 (skynews vod). Skip non-image media URLs; alt = title.

5) Telegram cron: post the top cluster only — Arabic title + one-line summary + link to https://ttbik.vercel.app/digest (or /news). No raw RSS, no duplicate same story same day.

Do not invent facts. Keep source links. One commit.
