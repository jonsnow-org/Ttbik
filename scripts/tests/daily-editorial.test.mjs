import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NEWS_ITEMS } from "../../src/lib/newsItems.ts";
import { ARTICLE_ITEMS } from "../../src/lib/articlesIndex.ts";
import { EVENT_EXTRAS } from "../../src/lib/eventsExtra.ts";
import { EN_NEWS, EN_ARTICLES, EN_EVENTS, isUpcomingDate } from "../../src/lib/enDesk.ts";

const sourceUrls = (item) => (item.sources ?? []).map((source) => source.href).sort();

test("18 November news entries have aligned Arabic and English versions", () => {
  const dailyNews = NEWS_ITEMS.filter((item) => item.dateIso === "2026-11-18");
  assert.equal(dailyNews.length, 4);

  for (const arabic of dailyNews) {
    const english = EN_NEWS.find((item) => item.slug === arabic.slug);
    assert.ok(english, `Missing English news entry for ${arabic.slug}`);
    assert.equal(english.date, "18 November 2026");
    assert.ok(arabic.contextDateLabel, `Missing event/report date for ${arabic.slug}`);
    assert.equal(english.contextDateLabel, arabic.contextDateLabel);
    assert.deepEqual(sourceUrls(english), sourceUrls(arabic));
    assert.ok(arabic.sources.length >= 1);
    assert.ok(arabic.sources.every((source) => source.href.startsWith("https://")));
  }
});

test("the superconductivity explainer is bilingual and avoids claiming room-temperature superconductivity", () => {
  const slug = "superconductivity-pairing-vs-room-temperature-2026";
  const arabic = ARTICLE_ITEMS.find((item) => item.slug === slug);
  const english = EN_ARTICLES.find((item) => item.slug === slug);

  assert.ok(arabic);
  assert.ok(english);
  assert.equal(arabic.dateIso, "2026-11-18");
  assert.equal(english.date, "18 November 2026");
  assert.deepEqual(sourceUrls(english), sourceUrls(arabic));
  assert.ok(arabic.paragraphs.length >= 5);
  assert.ok(english.body.length >= 5);
  assert.ok(arabic.takeaways.length >= 3);
  assert.ok(arabic.paragraphs.some((paragraph) => paragraph.includes("لا تعني")));
  assert.ok(english.body.some((paragraph) => paragraph.includes("does not mean")));
  assert.ok(arabic.sources.some((source) => source.href.includes("uu.nl")));
  assert.ok(arabic.sources.some((source) => source.href.includes("science.adt3444")));
});

test("current and upcoming global events have matching English dates and sources", () => {
  const expected = [
    { slug: "cop31-antalya-2026", dateIso: "2026-11-09", endDateIso: "2026-11-20", date: "2026-11-09", endDate: "2026-11-20", dateLabel: "9–20 November 2026" },
    { slug: "apec-economic-leaders-meeting-shenzhen-2026", dateIso: "2026-11-18", endDateIso: "2026-11-19", date: "2026-11-18", endDate: "2026-11-19", dateLabel: "18–19 November 2026" },
    { slug: "world-toilet-day-2026", dateIso: "2026-11-19", date: "2026-11-19", dateLabel: "19 November 2026" },
    { slug: "world-childrens-day-2026", dateIso: "2026-11-20", date: "2026-11-20", dateLabel: "20 November 2026" },
    { slug: "world-television-day-2026", dateIso: "2026-11-21", date: "2026-11-21", dateLabel: "21 November 2026" }
  ];

  for (const item of expected) {
    const arabic = EVENT_EXTRAS.find((event) => event.slug === item.slug);
    const english = EN_EVENTS.find((event) => event.slug === item.slug);
    assert.ok(arabic, `Missing Arabic event ${item.slug}`);
    assert.ok(english, `Missing English event ${item.slug}`);
    assert.equal(arabic.dateIso, item.dateIso);
    assert.equal(arabic.endDateIso, item.endDateIso);
    assert.equal(english.date, item.date);
    assert.equal(english.endDate, item.endDate);
    assert.equal(english.dateLabel, item.dateLabel);
    assert.equal(isUpcomingDate(english, "2026-11-18"), true);
    assert.deepEqual(sourceUrls(english), sourceUrls(arabic));
    assert.ok(arabic.sources.length >= 1);
  }
});

test("news and article detail pages label publication dates explicitly", () => {
  const arabicNews = readFileSync(new URL("../../src/app/news/[slug]/page.tsx", import.meta.url), "utf8");
  const englishNews = readFileSync(new URL("../../src/app/en/news/[slug]/page.tsx", import.meta.url), "utf8");
  const arabicArticles = readFileSync(new URL("../../src/app/articles/[slug]/page.tsx", import.meta.url), "utf8");
  const englishArticles = readFileSync(new URL("../../src/app/en/articles/[slug]/page.tsx", import.meta.url), "utf8");

  assert.match(arabicNews, /تاريخ النشر/);
  assert.match(arabicNews, /contextDateLabel/);
  assert.match(englishNews, /Published/);
  assert.match(englishNews, /contextDateLabel/);
  assert.match(arabicArticles, /تاريخ النشر/);
  assert.match(englishArticles, /Published/);
  const englishEvents = readFileSync(new URL("../../src/app/en/events/page.tsx", import.meta.url), "utf8");
  const englishEventDetail = readFileSync(new URL("../../src/app/en/events/[slug]/page.tsx", import.meta.url), "utf8");
  assert.match(englishEvents, /item\.dateLabel/);
  assert.match(englishEventDetail, /item\.dateLabel/);
});
