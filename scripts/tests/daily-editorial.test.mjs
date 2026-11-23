import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NEWS_ITEMS } from "../../src/lib/newsItems.ts";
import { ARTICLE_ITEMS } from "../../src/lib/articlesIndex.ts";
import { EVENT_EXTRAS, isEventCurrent, isEventUpcomingOrCurrent } from "../../src/lib/eventsExtra.ts";
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
    { slug: "iffi-goa-2026", dateIso: "2026-11-20", endDateIso: "2026-11-28", date: "2026-11-20", endDate: "2026-11-28", dateLabel: "20–28 November 2026" },
    { slug: "world-television-day-2026", dateIso: "2026-11-21", date: "2026-11-21", dateLabel: "21 November 2026" }
  ];

  for (const item of expected) {
    const arabic = [...EVENT_ITEMS, ...EVENT_EXTRAS].find((event) => event.slug === item.slug);
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



test("current and upcoming event filters distinguish the ongoing IFFI festival from completed COP31", () => {
  const iffiAr = EVENT_EXTRAS.find((event) => event.slug === "iffi-goa-2026");
  const iffiEn = EN_EVENTS.find((event) => event.slug === "iffi-goa-2026");
  const copAr = EVENT_EXTRAS.find((event) => event.slug === "cop31-antalya-2026");
  const copEn = EN_EVENTS.find((event) => event.slug === "cop31-antalya-2026");
  assert.ok(iffiAr && iffiEn && copAr && copEn);
  assert.equal(isEventCurrent(iffiAr, "2026-11-21"), true);
  assert.equal(isEventUpcomingOrCurrent(iffiAr, "2026-11-21"), true);
  assert.equal(isUpcomingDate(iffiEn, "2026-11-21"), true);
  assert.equal(isEventCurrent(copAr, "2026-11-21"), false);
  assert.equal(isEventUpcomingOrCurrent(copAr, "2026-11-21"), false);
  assert.equal(isUpcomingDate(copEn, "2026-11-21"), false);
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




test("Manipur public-health incident briefing uses matching official and independent figures without claiming a confirmed toxin", () => {
  const slug = "manipur-suspected-spurious-liquor-incident-2026";
  const arabic = NEWS_ITEMS.find((item) => item.slug === slug);
  const english = EN_NEWS.find((item) => item.slug === slug);
  assert.ok(arabic, "Arabic Manipur briefing is missing");
  assert.ok(english, "English Manipur briefing is missing");
  assert.equal(arabic.dateIso, "2026-11-21");
  assert.equal(english.date, "21 November 2026");
  assert.equal(dateNumbers(arabic.contextDateLabel), dateNumbers(english.contextDateLabel));
  assert.match(arabic.contextDateLabel, /21:36 IST/);
  assert.match(english.contextDateLabel, /16:06 UTC/);
  assert.deepEqual(sourceUrls(arabic), sourceUrls(english));
  assert.ok(arabic.sources.some((source) => source.href.includes("newsonair.gov.in")));
  assert.ok(arabic.sources.some((source) => source.href.includes("indianexpress.com")));
  assert.match(arabic.description, /الفحوص/);
  assert.match(english.dek, /tests.*still pending/i);
  assert.match(arabic.paragraphs.join(" "), /لا تصف هذه المادة الحادثة بأنها تسمم بالميثانول مؤكد/);
  assert.match(english.body.join(" "), /does not describe the incident as confirmed methanol poisoning/i);
});

test("COP31 update preserves the original publication date and synchronizes the 22 November outcome in both languages", () => {
  const slug = "cop31-overtime-climate-talks-2026";
  const arabic = NEWS_ITEMS.find((item) => item.slug === slug);
  const english = EN_NEWS.find((item) => item.slug === slug);
  const arabicEvent = EVENT_EXTRAS.find((item) => item.slug === "cop31-antalya-2026");
  const englishEvent = EN_EVENTS.find((item) => item.slug === "cop31-antalya-2026");
  assert.ok(arabic && english && arabicEvent && englishEvent);
  assert.equal(arabic.dateIso, "2026-11-21");
  assert.equal(arabic.dateLabel, "21 نوفمبر 2026");
  assert.equal(english.date, "21 November 2026");
  assert.equal(arabic.updatedDateIso, "2026-11-22");
  assert.equal(english.updatedDateIso, "2026-11-22");
  assert.equal(arabic.updatedDateLabel, "22 نوفمبر 2026");
  assert.equal(english.updatedDateLabel, "22 November 2026");
  assert.equal(dateNumbers(arabic.contextDateLabel), dateNumbers(english.contextDateLabel));
  assert.match(arabic.contextDateLabel, /تاريخ النشر الأصلي في شام AI: 21 نوفمبر 2026/);
  assert.match(english.contextDateLabel, /original Sham AI publication: 21 November 2026/);
  assert.deepEqual(sourceUrls(arabic), sourceUrls(english));
  assert.deepEqual(sourceUrls(arabicEvent), sourceUrls(englishEvent));
  assert.ok(arabic.sources.some((source) => source.href.includes("unfccc.int/news/")));
  assert.ok(arabic.sources.some((source) => source.href.includes("reuters.com") && source.href.includes("2026-11-22")));
  assert.ok(arabic.sources.some((source) => source.href.includes("apnews.com")));
  assert.match(arabic.description, /دون توافق على القرار السياسي الشامل/);
  assert.match(english.dek, /without consensus on an overarching political outcome/i);
  assert.match(arabic.paragraphs.join(" "), /22 نوفمبر 2026/);
  assert.match(english.body.join(" "), /22 November 2026/);
  assert.match(arabic.paragraphs.join(" "), /الانتقال العادل/);
  assert.match(english.body.join(" "), /Just Transition/);
  assert.equal(arabicEvent.endDateIso, "2026-11-20");
  assert.equal(englishEvent.endDate, "2026-11-20");
  assert.equal(isEventCurrent(arabicEvent, "2026-11-22"), false);
  assert.equal(isEventUpcomingOrCurrent(arabicEvent, "2026-11-22"), false);
  assert.equal(isUpcomingDate(englishEvent, "2026-11-22"), false);
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
  assert.ok(arabic.sources.some((source) => source.href.includes("admin.ch")));
  assert.ok(arabic.sources.some((source) => source.href.includes("ungeneva.org")));
  assert.ok(arabic.sources.some((source) => source.href.includes("docs-library.unoda.org")));
  assert.ok(arabic.sources.some((source) => source.href.includes("reuters.com")));
  assert.ok(arabic.sources.some((source) => source.href.includes("apnews.com")));
  assert.match(arabic.description, /2028/);
  assert.match(arabic.description, /ملزمة/);
  assert.match(arabic.paragraphs.join(" "), /128 دولة/);
  assert.match(english.body.join(" "), /128 states parties/);
  assert.match(english.dek, /2028/);
  assert.match(english.dek, /binding rules/i);
  assert.match(arabic.paragraphs.join(" "), /لا تعني نتيجة جنيف حظراً دولياً/);
  assert.match(english.body.join(" "), /does not amount to a new international ban/i);
});

test("21 November Hormuz tanker incidents are grounded in UKMTO alerts and do not assign responsibility", () => {
  const slug = "hormuz-tanker-incidents-khasab-2026";
  const arabic = NEWS_ITEMS.find((item) => item.slug === slug);
  const english = EN_NEWS.find((item) => item.slug === slug);
  assert.ok(arabic);
  assert.ok(english);
  assert.equal(arabic.dateIso, "2026-11-21");
  assert.equal(english.date, "21 November 2026");
  assert.match(arabic.contextDateLabel, /05:00 UTC/);
  assert.match(arabic.contextDateLabel, /05:50 UTC/);
  assert.deepEqual(sourceUrls(arabic), sourceUrls(english));
  assert.ok(arabic.sources.some((source) => source.href.includes("ukmto.org")));
  assert.ok(arabic.sources.some((source) => source.href.includes("reuters.com")));
  assert.ok(arabic.sources.some((source) => source.href.includes("apnews.com")));
  assert.match(arabic.paragraphs.join(" "), /ثلاث ناقلات/);
  assert.match(english.body.join(" "), /at least three oil tankers/);
  assert.match(arabic.paragraphs.join(" "), /لا تنسب هذه المادة الهجمات إلى طرف محدد|لا تمثل التقارير الثلاثة/);
  assert.match(english.body.join(" "), /does not attribute the attacks to any party/i);
  assert.match(english.body.join(" "), /could not independently verify the Iranian account/i);
});



test("BepiColombo coverage separates the scheduled Mercury insertion from a confirmed success", () => {
  const arabic = NEWS_ITEMS.find((entry) => entry.slug === "bepicolombo-mercury-orbit-insertion-status-2026");
  const english = EN_NEWS.find((entry) => entry.slug === "bepicolombo-mercury-orbit-insertion-status-2026");
  assert.ok(arabic && english);
  assert.equal(arabic.dateIso, "2026-11-21");
  assert.equal(english.date, "21 November 2026");
  assert.equal(dateNumbers(arabic.contextDateLabel), dateNumbers(english.contextDateLabel));
  assert.deepEqual(sourceUrls(arabic), sourceUrls(english));
  assert.ok(arabic.sources.some((source) => source.href.includes("bepicolombo.esac.esa.int")));
  assert.ok(arabic.sources.some((source) => source.href.includes("esa.int")));
  assert.ok(arabic.sources.some((source) => source.href.includes("jaxa.jp")));
  assert.ok(arabic.sources.some((source) => source.href.includes("theguardian.com")));
  assert.match(arabic.description, /حالة التنفيذ غير مؤكدة/);
  assert.match(arabic.paragraphs.join(" "), /17:34:35 UTC/);
  assert.match(english.body.join(" "), /completion status unconfirmed/i);
  assert.doesNotMatch(english.title, /successfully entered orbit/i);
});

test("21 November humanitarian and security updates are bilingual, source-matched and preserve attribution", () => {
  const cases = [
    {
      slug: "gaza-city-food-vehicle-strike-2026",
      sources: ["idf.il", "reuters.com", "apnews.com"],
      ar: /لم تكن تابعة لها/,
      en: /not affiliated with the charity/i,
      caveat: /لم تتمكن من التحقق مستقلاً/
    },
    {
      slug: "bahrain-industrial-facility-fire-2026",
      sources: ["x.com/moi_bahrain", "reuters.com", "aa.com.tr"],
      ar: /دون إصابات/,
      en: /no injuries/i,
      caveat: /لم تحدد الوزارة/
    },
    {
      slug: "russian-cargo-ship-sparta-ii-fire-2026",
      sources: ["epressi.com", "reuters.com"],
      ar: /الطاقم الستة عشر/,
      en: /16-member crew/,
      caveat: /لا توجد معلومات مؤكدة عن الحمولة/
    },
    {
      slug: "iraq-hartha-power-station-fire-2026",
      sources: ["reuters.com", "aa.com.tr"],
      ar: /أربعة قتلى و35 مصاباً/,
      en: /four dead and 35 injured/,
      caveat: /الأرقام أولية/
    }
  ];

  for (const item of cases) {
    const arabic = NEWS_ITEMS.find((entry) => entry.slug === item.slug);
    const english = EN_NEWS.find((entry) => entry.slug === item.slug);
    assert.ok(arabic, `Missing Arabic entry for ${item.slug}`);
    assert.ok(english, `Missing English entry for ${item.slug}`);
    assert.equal(arabic.dateIso, "2026-11-21");
    assert.equal(english.date, "21 November 2026");
    assert.equal(dateNumbers(arabic.contextDateLabel), dateNumbers(english.contextDateLabel));
    assert.deepEqual(sourceUrls(arabic), sourceUrls(english));
    assert.ok(arabic.sources.length >= 2);
    assert.ok(arabic.sources.every((source) => source.href.startsWith("https://")));
    for (const domain of item.sources) assert.ok(arabic.sources.some((source) => source.href.includes(domain)), `Missing source ${domain} for ${item.slug}`);
    assert.match(arabic.paragraphs.join(" "), item.ar);
    assert.match(english.body.join(" "), item.en);
    assert.match(arabic.paragraphs.join(" "), item.caveat);
  }
});

test("AI-led market sell-off preserves its original publication date and records the 23 November Korea follow-up", () => {
  const slug = "us-ai-tech-selloff-correction-november-2026";
  const arabic = NEWS_ITEMS.find((item) => item.slug === slug);
  const english = EN_NEWS.find((item) => item.slug === slug);
  assert.ok(arabic);
  assert.ok(english);
  assert.equal(arabic.dateIso, "2026-11-21");
  assert.equal(english.date, "21 November 2026");
  assert.equal(arabic.updatedDateIso, "2026-11-23");
  assert.equal(english.updatedDateIso, "2026-11-23");
  assert.equal(arabic.updatedDateLabel, "23 نوفمبر 2026");
  assert.equal(english.updatedDateLabel, "23 November 2026");
  assert.match(arabic.contextDateLabel, /جلسة السوق الأميركية: الجمعة 20 نوفمبر 2026/);
  assert.match(english.contextDateLabel, /U.S. market session: Friday, 20 November 2026/);
  assert.match(arabic.contextDateLabel, /تقرير يونهاب عن الإغلاق: 23 نوفمبر 2026، 15:34 KST/);
  assert.match(english.contextDateLabel, /Yonhap closing report: 23 November 2026, 15:34 KST/);
  assert.deepEqual(sourceUrls(arabic), sourceUrls(english));
  for (const domain of ["reuters.com", "apnews.com", "yna.co.kr", "koreatimes.co.kr"]) {
    assert.ok(arabic.sources.some((source) => source.href.includes(domain)), `Missing source ${domain}`);
  }
  assert.match(arabic.paragraphs.join(" "), /4,708\.54/);
  assert.match(arabic.paragraphs.join(" "), /3\.31%/);
  assert.match(arabic.paragraphs.join(" "), /4,586\.80/);
  assert.match(english.body.join(" "), /4,708\.54/);
  assert.match(english.body.join(" "), /3\.31%/);
  assert.match(english.body.join(" "), /4,586\.80/);
  assert.match(english.body.join(" "), /not investment advice/i);
});

test("Gaza winter story preserves its original publication date and records the 21 November update in both languages", () => {
  const slug = "gaza-winter-rains-shelter-crisis-2026";
  const arabic = NEWS_ITEMS.find((item) => item.slug === slug);
  const english = EN_NEWS.find((item) => item.slug === slug);
  assert.ok(arabic);
  assert.ok(english);
  assert.equal(arabic.dateIso, "2026-11-18");
  assert.equal(english.date, "18 November 2026");
  assert.match(arabic.contextDateLabel, /تاريخ النشر الأصلي: 18 نوفمبر 2026/);
  assert.match(arabic.contextDateLabel, /تحديث المادة: 21 نوفمبر 2026/);
  assert.match(english.contextDateLabel, /Original publication: 18 November 2026/);
  assert.match(english.contextDateLabel, /article updated: 21 November 2026/);
  assert.deepEqual(sourceUrls(arabic), sourceUrls(english));
  assert.ok(arabic.sources.some((source) => source.href.includes("theguardian.com")));
  assert.match(english.body.join(" "), /220,000 people/);
  assert.match(english.body.join(" "), /40,000 shelters/);
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
  const arabicUpcoming = readFileSync(new URL("../../src/app/events/upcoming/page.tsx", import.meta.url), "utf8");
  assert.match(englishEvents, /item\.dateLabel/);
  assert.match(englishEventDetail, /item\.dateLabel/);
  assert.match(englishUpcoming, /item\.dateLabel/);
  assert.match(arabicUpcoming, /الأحداث الجارية والقادمة/);
  assert.match(englishUpcoming, /Current and upcoming/);
});

test("Riemann hypothesis Lean proof briefing is bilingual and preserves verification scope and unfinished checks", () => {
  const slug = "riemann-hypothesis-lean-verification-2026";
  const arabic = NEWS_ITEMS.find((item) => item.slug === slug);
  const english = EN_NEWS.find((item) => item.slug === slug);
  assert.ok(arabic, "Arabic Riemann briefing is missing");
  assert.ok(english, "English Riemann briefing is missing");
  assert.equal(arabic.dateIso, "2026-11-22");
  assert.equal(english.date, "22 November 2026");
  assert.equal(dateNumbers(arabic.contextDateLabel), dateNumbers(english.contextDateLabel));
  assert.deepEqual(sourceUrls(arabic), sourceUrls(english));
  assert.ok(arabic.sources.some((source) => source.href.includes("alpo.ge/remark.pdf")));
  assert.ok(arabic.sources.some((source) => source.href.includes("leanprover-community.github.io")));
  assert.ok(arabic.sources.some((source) => source.href.includes("math.mit.edu/~drew/grh")));
  assert.ok(arabic.sources.some((source) => source.href.includes("theguardian.com/technology/2026/nov/21")));
  assert.match(arabic.contextDateLabel, /16:20 UTC/);
  assert.match(english.contextDateLabel, /17:55 UTC/);
  assert.match(arabic.paragraphs.join(" "), /لا ينبغي القول إن كل فحص طويل الأمد انتهى/);
  assert.match(english.body.join(" "), /should not be described as finished/i);
  assert.match(arabic.paragraphs.join(" "), /Dirichlet L-functions/);
  assert.match(english.body.join(" "), /not Dedekind zeta functions/i);
  assert.doesNotMatch(arabic.title, /جائزة معهد كلاي/);
  assert.doesNotMatch(english.title, /Clay Mathematics Institute/i);
});

test("22 November China margin-financing rule is bilingual, date-aligned and avoids market-return promises", () => {
  const slug = "china-margin-financing-ratio-80-november-2026";
  const arabic = NEWS_ITEMS.find((item) => item.slug === slug);
  const english = EN_NEWS.find((item) => item.slug === slug);
  assert.ok(arabic, "Arabic China margin-rule briefing is missing");
  assert.ok(english, "English China margin-rule briefing is missing");
  assert.equal(arabic.dateIso, "2026-11-22");
  assert.equal(english.date, "22 November 2026");
  assert.equal(dateNumbers(arabic.contextDateLabel), dateNumbers(english.contextDateLabel));
  assert.deepEqual(sourceUrls(arabic), sourceUrls(english));
  for (const domain of ["sse.com.cn", "szse.cn", "bse.cn", "reuters.com"]) {
    assert.ok(arabic.sources.some((source) => source.href.includes(domain)), `Missing source ${domain}`);
  }
  assert.match(arabic.paragraphs.join(" "), /30 نوفمبر 2026/);
  assert.match(english.body.join(" "), /30 November 2026/);
  assert.match(arabic.paragraphs.join(" "), /لا يعني ذلك أن كل عقد سيُعدّل تلقائياً/);
  assert.match(english.body.join(" "), /does not mean every existing contract will be adjusted automatically/i);
  assert.match(arabic.paragraphs.join(" "), /لا يضمن خفض النسبة ارتفاع أسعار/);
  assert.match(english.body.join(" "), /does not guarantee higher securities prices/i);
  assert.match(arabic.paragraphs.join(" "), /لا يمثل توصية بالاقتراض أو الشراء/);
  assert.match(english.body.join(" "), /not an investment recommendation/i);
});

test("22 November Poland Kh-101 update preserves the preliminary status and event/publication dates", () => {
  const slug = "poland-airspace-kh101-preliminary-identification-2026";
  const arabic = NEWS_ITEMS.find((item) => item.slug === slug);
  const english = EN_NEWS.find((item) => item.slug === slug);
  assert.ok(arabic, "Arabic Poland update is missing");
  assert.ok(english, "English Poland update is missing");
  assert.equal(arabic.dateIso, "2026-11-22");
  assert.equal(english.date, "22 November 2026");
  assert.equal(dateNumbers(arabic.contextDateLabel), dateNumbers(english.contextDateLabel));
  assert.deepEqual(sourceUrls(arabic), sourceUrls(english));
  for (const domain of ["gov.pl", "reuters.com", "sharjah24.ae", "pb.pl"]) {
    assert.ok(arabic.sources.some((source) => source.href.includes(domain)), `Missing source ${domain}`);
  }
  assert.match(arabic.paragraphs.join(" "), /20 نوفمبر 2026/);
  assert.match(english.body.join(" "), /20 November 2026/);
  assert.match(arabic.paragraphs.join(" "), /الفحوص الأولية/);
  assert.match(english.body.join(" "), /preliminary investigative findings/i);
  assert.match([arabic.description, ...arabic.paragraphs].join(" "), /لا تمثل نتيجة نهائية/);
  assert.match([english.dek, ...english.body].join(" "), /not a final forensic or judicial determination/i);
  assert.match(arabic.paragraphs.join(" "), /لم يثبت في هذه البيانات أن الحادث كان استهدافاً مقصوداً/);
  assert.match(english.body.join(" "), /do not establish that the incident was a deliberate attack/i);
});
