import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NEWS_ITEMS } from "../../src/lib/newsItems.ts";
import { ARTICLE_ITEMS } from "../../src/lib/articlesIndex.ts";
import { EVENT_EXTRAS } from "../../src/lib/eventsExtra.ts";
import { EVENT_ITEMS, latestEvent } from "../../src/lib/eventsIndex.ts";
import { EN_NEWS, EN_ARTICLES, EN_EVENTS, isUpcomingDate } from "../../src/lib/enDesk.ts";

const sourceUrls = (item) => (item.sources ?? []).map((source) => source.href).sort();
const dateNumbers = (value) => (value.match(/\d+/g) ?? []).join(",");

test("18 November news entries have aligned Arabic and English versions", () => {
  const dailyNews = NEWS_ITEMS.filter((item) => item.dateIso === "2026-11-18");
  assert.equal(dailyNews.length, 4);

  for (const arabic of dailyNews) {
    const english = EN_NEWS.find((item) => item.slug === arabic.slug);
    assert.ok(english, `Missing English news entry for ${arabic.slug}`);
    assert.equal(english.date, "18 November 2026");
    assert.ok(arabic.contextDateLabel, `Missing event/report date for ${arabic.slug}`);
    assert.ok(english.contextDateLabel, `Missing English event/report date for ${arabic.slug}`);
    assert.equal(dateNumbers(english.contextDateLabel), dateNumbers(arabic.contextDateLabel));
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


test("20 November global news is bilingual, date-aligned and supported by primary and independent sources", () => {
  const slugs = ["icj-myanmar-rohingya-judgment-2026", "wfp-2027-global-outlook-food-aid-2026"];
  for (const slug of slugs) {
    const arabic = NEWS_ITEMS.find((item) => item.slug === slug);
    const english = EN_NEWS.find((item) => item.slug === slug);
    assert.ok(arabic, `Missing Arabic news entry for ${slug}`);
    assert.ok(english, `Missing English news entry for ${slug}`);
    assert.equal(arabic.dateIso, "2026-11-20");
    assert.equal(english.date, "20 November 2026");
    assert.equal(dateNumbers(english.contextDateLabel), dateNumbers(arabic.contextDateLabel));
    assert.deepEqual(sourceUrls(english), sourceUrls(arabic));
    assert.ok(arabic.paragraphs.length >= 4);
    assert.ok(arabic.sources.length >= 2);
    assert.ok(arabic.sources.every((source) => source.href.startsWith("https://")));
  }
  const icj = NEWS_ITEMS.find((item) => item.slug === slugs[0]);
  const wfp = NEWS_ITEMS.find((item) => item.slug === slugs[1]);
  assert.ok(icj.sources.some((source) => source.href.includes("iimm.un.org")));
  assert.ok(icj.sources.some((source) => source.href.includes("apnews.com")));
  assert.ok(icj.sources.some((source) => source.href.includes("mofa.gov.mm")));
  assert.ok(wfp.sources.some((source) => source.href.includes("wfp.org")));
  assert.ok(wfp.sources.some((source) => source.href.includes("reuters.com")));
  assert.ok(wfp.paragraphs.some((paragraph) => paragraph.includes("2025")));
});

test("APEC news and event records are updated after the 19 November meeting without changing the original publication date", () => {
  const arabicNews = NEWS_ITEMS.find((item) => item.slug === "apec-shenzhen-leaders-trade-2026");
  const englishNews = EN_NEWS.find((item) => item.slug === "apec-shenzhen-leaders-trade-2026");
  const arabicEvent = EVENT_EXTRAS.find((item) => item.slug === "apec-economic-leaders-meeting-shenzhen-2026");
  const englishEvent = EN_EVENTS.find((item) => item.slug === "apec-economic-leaders-meeting-shenzhen-2026");
  assert.ok(arabicNews);
  assert.ok(englishNews);
  assert.ok(arabicEvent);
  assert.ok(englishEvent);
  assert.equal(arabicNews.dateIso, "2026-11-18");
  assert.equal(englishNews.date, "18 November 2026");
  assert.match(arabicNews.contextDateLabel, /تحديث المادة: 20 نوفمبر 2026/);
  assert.match(englishNews.contextDateLabel, /article updated: 20 November 2026/);
  assert.match(arabicNews.description, /اجتمع/);
  assert.doesNotMatch(arabicNews.description, /كان مقررًا في اليوم التالي/);
  assert.match(englishNews.dek, /met in Shenzhen/);
  assert.doesNotMatch(englishNews.dek, /was scheduled for the following day/);
  assert.deepEqual(sourceUrls(arabicNews), sourceUrls(englishNews));
  assert.equal(arabicEvent.dateIso, "2026-11-18");
  assert.equal(arabicEvent.endDateIso, "2026-11-19");
  assert.equal(englishEvent.date, "2026-11-18");
  assert.equal(englishEvent.endDate, "2026-11-19");
  assert.match(arabicEvent.paragraphs[0], /انعقد/);
  assert.doesNotMatch(arabicEvent.paragraphs[0], /من المقرر/);
  assert.match(englishEvent.body[0], /took place/);
  assert.doesNotMatch(englishEvent.body[0], /is scheduled/);
  assert.deepEqual(sourceUrls(arabicEvent), sourceUrls(englishEvent));
});



test("COP31 overtime briefing is bilingual, date-aware and distinguishes the draft from an adopted deal", () => {
  const slug = "cop31-overtime-climate-talks-2026";
  const arabic = NEWS_ITEMS.find((item) => item.slug === slug);
  const english = EN_NEWS.find((item) => item.slug === slug);
  assert.ok(arabic, "Arabic COP31 briefing is missing");
  assert.ok(english, "English COP31 briefing is missing");
  assert.equal(arabic.dateIso, "2026-11-21");
  assert.equal(english.date, "21 November 2026");
  assert.equal(dateNumbers(arabic.contextDateLabel), dateNumbers(english.contextDateLabel));
  assert.match(arabic.contextDateLabel, /14:36 UTC/);
  assert.match(english.contextDateLabel, /19:25 UTC/);
  assert.deepEqual(sourceUrls(arabic), sourceUrls(english));
  assert.ok(arabic.sources.some((source) => source.href === "https://unfccc.int/cop31"));
  assert.ok(arabic.sources.some((source) => source.href.includes("reuters.com")));
  assert.ok(arabic.sources.some((source) => source.href.includes("apnews.com")));
  assert.ok(arabic.sources.some((source) => source.href.includes("theguardian.com")));
  assert.match(arabic.description, /دون تسوية نهائية/);
  assert.match(english.dek, /still unresolved/i);
  assert.match(arabic.paragraphs.join(" "), /لا ينبغي عرض القمة على أنها حدث قادم/);
  assert.match(english.body.join(" "), /must not be presented as upcoming/i);
  assert.match(english.body.join(" "), /draft must not be described as an adopted agreement/i);
});

test("21 November autonomous-weapons briefing is bilingual, source-matched and does not overstate the outcome", () => {
  const slug = "ccw-autonomous-weapons-geneva-2026";
  const arabic = NEWS_ITEMS.find((item) => item.slug === slug);
  const english = EN_NEWS.find((item) => item.slug === slug);
  assert.ok(arabic, "Arabic briefing is missing");
  assert.ok(english, "English briefing is missing");
  assert.equal(arabic.dateIso, "2026-11-21");
  assert.equal(english.date, "21 November 2026");
  assert.equal(dateNumbers(arabic.contextDateLabel), dateNumbers(english.contextDateLabel));
  assert.match(arabic.contextDateLabel, /05:36 UTC/);
  assert.match(english.contextDateLabel, /03:00 GMT/);
  assert.deepEqual(sourceUrls(arabic), sourceUrls(english));
  assert.ok(arabic.sources.length >= 4);
  assert.ok(arabic.sources.some((source) => source.href.includes("ungeneva.org")));
  assert.ok(arabic.sources.some((source) => source.href.includes("docs-library.unoda.org")));
  assert.ok(arabic.sources.some((source) => source.href.includes("reuters.com")));
  assert.ok(arabic.sources.some((source) => source.href.includes("apnews.com")));
  assert.match(arabic.description, /2028/);
  assert.match(arabic.description, /ملزمة/);
  assert.match(english.dek, /2028/);
  assert.match(english.dek, /binding rules/i);
  assert.match(arabic.paragraphs.join(" "), /لا تعني نتيجة جنيف حظراً دولياً/);
  assert.match(english.body.join(" "), /does not amount to a new international ban/i);
});

test("the homepage resolves its event strip from the combined event catalogue, not the empty legacy array", () => {
  const expected = [...EVENT_ITEMS, ...EVENT_EXTRAS].sort((a, b) => b.dateIso.localeCompare(a.dateIso))[0];
  assert.ok(expected, "The event catalogue should contain editorial events");
  assert.equal(latestEvent()?.slug, expected.slug);
  const home = readFileSync(new URL("../../src/app/page.tsx", import.meta.url), "utf8");
  assert.match(home, /const event = latestEvent\(\)/);
  assert.match(home, /latestEvent=\{event && \{ slug: event\.slug, title: event\.title \}\}/);
  assert.doesNotMatch(home, /EVENT_ITEMS\[0\]/);
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
  const englishUpcoming = readFileSync(new URL("../../src/app/en/events/upcoming/page.tsx", import.meta.url), "utf8");
  assert.match(englishEvents, /item\.dateLabel/);
  assert.match(englishEventDetail, /item\.dateLabel/);
  assert.match(englishUpcoming, /item\.dateLabel/);
});
