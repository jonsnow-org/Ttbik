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
    { slug: "sixteen-days-activism-gender-based-violence-2026", dateIso: "2026-11-25", endDateIso: "2026-12-10", date: "2026-11-25", endDate: "2026-12-10", dateLabel: "25 November – 10 December 2026" },
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

test("COP31 update preserves the original publication date and synchronizes the 23 November official outcome in both languages", () => {
  const slug = "cop31-overtime-climate-talks-2026";
  const arabic = NEWS_ITEMS.find((item) => item.slug === slug);
  const english = EN_NEWS.find((item) => item.slug === slug);
  const arabicEvent = EVENT_EXTRAS.find((item) => item.slug === "cop31-antalya-2026");
  const englishEvent = EN_EVENTS.find((item) => item.slug === "cop31-antalya-2026");
  assert.ok(arabic && english && arabicEvent && englishEvent);
  assert.equal(arabic.dateIso, "2026-11-21");
  assert.equal(arabic.dateLabel, "21 نوفمبر 2026");
  assert.equal(english.date, "21 November 2026");
  assert.equal(arabic.updatedDateIso, "2026-11-23");
  assert.equal(english.updatedDateIso, "2026-11-23");
  assert.equal(arabic.updatedDateLabel, "23 نوفمبر 2026");
  assert.equal(english.updatedDateLabel, "23 November 2026");
  assert.equal(dateNumbers(arabic.contextDateLabel), dateNumbers(english.contextDateLabel));
  assert.match(arabic.contextDateLabel, /تاريخ النشر الأصلي في شام AI: 21 نوفمبر 2026/);
  assert.match(english.contextDateLabel, /original Sham AI publication: 21 November 2026/);
  assert.deepEqual(sourceUrls(arabic), sourceUrls(english));
  assert.deepEqual(sourceUrls(arabicEvent), sourceUrls(englishEvent));
  assert.ok(arabic.sources.some((source) => source.href.includes("unfccc.int/news/") && source.href.includes("cop31-delivers-progress")));
  assert.ok(arabic.sources.some((source) => source.href.includes("reuters.com") && source.href.includes("2026-11-22")));
  assert.ok(arabic.sources.some((source) => source.href.includes("apnews.com")));
  assert.match(arabic.description, /دون توافق على القرار السياسي الشامل/);
  assert.match(english.dek, /without consensus on an overarching political outcome/i);
  assert.match(arabic.paragraphs.join(" "), /23 نوفمبر 2026/);
  assert.match(english.body.join(" "), /23 November 2026/);
  assert.match(arabic.paragraphs.join(" "), /تمويل المناخ والتكيف/);
  assert.match(english.body.join(" "), /climate finance and adaptation/i);
  assert.match(arabic.paragraphs.join(" "), /نحو نصف الاقتصاد العالمي/);
  assert.match(english.body.join(" "), /around half of the global economy/i);
  assert.equal(arabicEvent.endDateIso, "2026-11-20");
  assert.equal(englishEvent.endDate, "2026-11-20");
  assert.equal(isEventCurrent(arabicEvent, "2026-11-23"), false);
  assert.equal(isEventUpcomingOrCurrent(arabicEvent, "2026-11-23"), false);
  assert.equal(isUpcomingDate(englishEvent, "2026-11-23"), false);
});

test("23 November Bank of Israel rate decision is bilingual, source-matched and preserves official timing qualifiers", () => {
  const slug = "bank-israel-holds-rate-3-25-november-2026";
  const arabic = NEWS_ITEMS.find((item) => item.slug === slug);
  const english = EN_NEWS.find((item) => item.slug === slug);
  assert.ok(arabic, "Arabic Bank of Israel briefing is missing");
  assert.ok(english, "English Bank of Israel briefing is missing");
  assert.equal(arabic.dateIso, "2026-11-23");
  assert.equal(english.date, "23 November 2026");
  assert.equal(dateNumbers(arabic.contextDateLabel), dateNumbers(english.contextDateLabel));
  assert.match(arabic.contextDateLabel, /لا تعرض صفحة البنك ساعة النشر/);
  assert.match(english.contextDateLabel, /does not show a publication time/i);
  assert.match(arabic.contextDateLabel, /17:57 UTC/);
  assert.match(english.contextDateLabel, /20:57 Istanbul/);
  assert.deepEqual(sourceUrls(arabic), sourceUrls(english));
  assert.ok(arabic.sources.some((source) => source.href.includes("boi.org.il")));
  assert.ok(arabic.sources.some((source) => source.href.includes("reuters.com/markets/asia/bank-israel-leaves-rates-unchanged")));
  assert.match(arabic.paragraphs.join(" "), /3\.25%/);
  assert.match(english.body.join(" "), /3\.25%/);
  assert.match(arabic.paragraphs.join(" "), /1\.1%/);
  assert.match(english.body.join(" "), /1\.1%/);
  assert.match(arabic.paragraphs.join(" "), /7\.6%/);
  assert.match(english.body.join(" "), /7\.6%/);
  assert.match(arabic.paragraphs.join(" "), /معدل سنوي قدره 8%/);
  assert.match(english.body.join(" "), /annualized rate of 8%/);
  assert.match(arabic.paragraphs.join(" "), /بلغ النمو السنوي المعدل 4%/);
  assert.match(english.body.join(" "), /annualized growth rate was 4%/);
  assert.match(arabic.paragraphs.join(" "), /لا يقدّم هذا التقرير.*توصية/);
  assert.match(english.body.join(" "), /does not.*recommend borrowing or investing/i);
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
  assert.match([arabic.description, ...arabic.paragraphs].join(" "), /لا تمثل النتائج حكماً جنائياً أو فنياً نهائياً/);
  assert.match([english.dek, ...english.body].join(" "), /not a final forensic or judicial determination/i);
  assert.match(arabic.paragraphs.join(" "), /لم يثبت في هذه البيانات أن الحادث كان استهدافاً مقصوداً/);
  assert.match(english.body.join(" "), /do not establish that the incident was a deliberate attack/i);
});

test("23 November WFP briefing keeps the projected humanitarian risk conditional in both languages", () => {
  const slug = "wfp-warns-trade-route-disruptions-risk-food-aid-7-3-million-nov-2026";
  const arabic = NEWS_ITEMS.find((item) => item.slug === slug);
  const english = EN_NEWS.find((item) => item.slug === slug);
  assert.ok(arabic, "Arabic WFP briefing is missing");
  assert.ok(english, "English WFP briefing is missing");
  assert.equal(arabic.dateIso, "2026-11-23");
  assert.equal(english.date, "23 November 2026");
  assert.deepEqual(sourceUrls(arabic), sourceUrls(english));
  assert.ok(arabic.sources.some((source) => source.href.includes("wfp.org/stories/")));
  assert.ok(arabic.sources.some((source) => source.href.includes("reuters.com/business/environment/")));
  assert.match(arabic.contextDateLabel, /16:51 UTC/);
  assert.match(english.contextDateLabel, /16:51 UTC/);
  assert.match(arabic.paragraphs.join(" "), /727 مليون دولار/);
  assert.match(english.body.join(" "), /US\$727 million/);
  assert.match(arabic.paragraphs.join(" "), /قد تتعرض المساعدة لـ7\.3 ملايين شخص للخطر/);
  assert.match(english.body.join(" "), /potentially putting assistance for 7\.3 million people at risk/i);
  assert.match(arabic.paragraphs.join(" "), /إذا استمرت الظروف الحالية/);
  assert.match(english.body.join(" "), /if current conditions persist/i);
  assert.match(arabic.paragraphs.join(" "), /لا تعني أن التمويل خُفّض بالفعل/);
  assert.match(english.body.join(" "), /not a confirmed funding cut/i);
});

test("23 November Amazon–Decart agreement distinguishes the signed agreement from completion and the reported price", () => {
  const slug = "amazon-agrees-to-acquire-decart-ai-optimization-technology-november-2026";
  const arabic = NEWS_ITEMS.find((item) => item.slug === slug);
  const english = EN_NEWS.find((item) => item.slug === slug);
  assert.ok(arabic, "Arabic Amazon–Decart briefing is missing");
  assert.ok(english, "English Amazon–Decart briefing is missing");
  assert.equal(arabic.dateIso, "2026-11-23");
  assert.equal(english.date, "23 November 2026");
  assert.deepEqual(sourceUrls(arabic), sourceUrls(english));
  assert.ok(arabic.sources.some((source) => source.href.includes("aboutamazon.com")));
  assert.ok(arabic.sources.some((source) => source.href.includes("reuters.com/business/retail-consumer/")));
  assert.match(arabic.contextDateLabel, /15:33 UTC/);
  assert.match(english.contextDateLabel, /15:33 UTC/);
  assert.match(arabic.paragraphs.join(" "), /لم تكشف أمازون الشروط المالية/);
  assert.match(english.body.join(" "), /Amazon did not disclose the deal's financial terms/i);
  assert.match(arabic.paragraphs.join(" "), /7\.5 مليارات دولار/);
  assert.match(english.body.join(" "), /US\$7\.5 billion/);
  assert.match(arabic.paragraphs.join(" "), /أمازون لم تؤكد هذا الرقم/);
  assert.match(english.body.join(" "), /Amazon did not confirm that figure/i);
  assert.match(arabic.paragraphs.join(" "), /الموافقات التنظيمية/);
  assert.match(english.body.join(" "), /regulatory clearance/i);
});

test("24 November Euclid quasar discovery is bilingual and separates the cosmic epoch from publication time", () => {
  const slug = "euclid-dun-aonghasa-quasar-record-2026";
  const arabic = NEWS_ITEMS.find((item) => item.slug === slug);
  const english = EN_NEWS.find((item) => item.slug === slug);
  assert.ok(arabic, "Arabic Euclid quasar briefing is missing");
  assert.ok(english, "English Euclid quasar briefing is missing");
  assert.equal(arabic.dateIso, "2026-11-24");
  assert.equal(english.date, "24 November 2026");
  assert.equal(dateNumbers(english.contextDateLabel), dateNumbers(arabic.contextDateLabel));
  assert.match(arabic.contextDateLabel, /14:11 UTC/);
  assert.match(english.contextDateLabel, /14:11 UTC/);
  assert.match(arabic.contextDateLabel, /630 مليون سنة/);
  assert.match(english.contextDateLabel, /630 million years/);
  assert.deepEqual(sourceUrls(arabic), sourceUrls(english));
  assert.ok(arabic.sources.some((source) => source.href.includes("esa.int")));
  assert.ok(arabic.sources.some((source) => source.href.includes("doi.org/10.1051/0004-6361/202662243")));
  assert.ok(arabic.sources.some((source) => source.href.includes("reuters.com/science/")));
  assert.match(arabic.paragraphs.join(" "), /لا نتيجة أثبتتها هذه المشاهدات/);
  assert.match(english.body.join(" "), /not a formation pathway established by these observations/);
});


test("24 November Japan economic assessment is bilingual and does not turn a qualitative downgrade into a measured spending decline", () => {
  const slug = "japan-november-consumer-spending-assessment-2026";
  const arabic = NEWS_ITEMS.find((item) => item.slug === slug);
  const english = EN_NEWS.find((item) => item.slug === slug);
  assert.ok(arabic, "Arabic Japan economic briefing is missing");
  assert.ok(english, "English Japan economic briefing is missing");
  assert.equal(arabic.dateIso, "2026-11-24");
  assert.equal(english.date, "24 November 2026");
  assert.equal(dateNumbers(arabic.contextDateLabel), dateNumbers(english.contextDateLabel));
  assert.match(arabic.contextDateLabel, /08:21 UTC/);
  assert.match(english.contextDateLabel, /08:21 UTC/);
  assert.deepEqual(sourceUrls(arabic), sourceUrls(english));
  assert.ok(arabic.sources.some((source) => source.href.includes("cao.go.jp/keizai3/getsurei-e/2026nov.html")));
  assert.ok(arabic.sources.some((source) => source.href.includes("reuters.com/markets/asia/japan-cuts-view-consumer-spending")));
  assert.match(arabic.description, /لا يثبت انخفاضاً رقمياً/);
  assert.match(english.dek, /not a measured fall in spending/i);
  assert.match(arabic.paragraphs.join(" "), /للمرة الأولى منذ فبراير 2024/);
  assert.match(english.body.join(" "), /first time since February 2024/i);
  assert.match(arabic.paragraphs.join(" "), /معدات تصنيع أشباه الموصلات/);
  assert.match(english.body.join(" "), /semiconductor-manufacturing equipment/i);
  assert.match(arabic.paragraphs.join(" "), /لا تقدم توصية مالية أو استثمارية/);
  assert.match(english.body.join(" "), /not financial or investment advice/i);
});


test("24 November WHO Cuba support briefing is bilingual and attributes contested fuel-policy claims", () => {
  const slug = "cuba-who-immunization-support-2026";
  const arabic = NEWS_ITEMS.find((item) => item.slug === slug);
  const english = EN_NEWS.find((item) => item.slug === slug);
  assert.ok(arabic, "Arabic WHO Cuba briefing is missing");
  assert.ok(english, "English WHO Cuba briefing is missing");
  assert.equal(arabic.dateIso, "2026-11-24");
  assert.equal(english.date, "24 November 2026");
  assert.equal(dateNumbers(arabic.contextDateLabel), dateNumbers(english.contextDateLabel));
  assert.match(arabic.contextDateLabel, /22 نوفمبر 2026/);
  assert.match(english.contextDateLabel, /22 November 2026/);
  assert.match(arabic.contextDateLabel, /19:26 UTC/);
  assert.match(english.contextDateLabel, /19:26 UTC/);
  assert.deepEqual(sourceUrls(arabic), sourceUrls(english));
  for (const domain of ["who.int", "paho.org", "reuters.com"]) {
    assert.ok(arabic.sources.some((source) => source.href.includes(domain)), `Missing source ${domain}`);
  }
  assert.match(arabic.paragraphs.join(" "), /62,000 مولود/);
  assert.match(english.body.join(" "), /62,000 newborns/);
  assert.match(arabic.paragraphs.join(" "), /780,000/);
  assert.match(english.body.join(" "), /780,000/);
  assert.match(arabic.paragraphs.join(" "), /110,000/);
  assert.match(english.body.join(" "), /110,000/);
  assert.match(arabic.paragraphs.join(" "), /98%.*95%/);
  assert.match(english.body.join(" "), /98%.*95%/);
  assert.match(arabic.paragraphs.join(" "), /مواقف منسوبة إلى أصحابها/);
  assert.match(english.body.join(" "), /attributed positions/i);
  assert.match(arabic.paragraphs.join(" "), /لا يثبت وحده حل أزمة الخدمات الصحية/);
  assert.match(english.body.join(" "), /not proof that Cuba's wider health-service crisis has been resolved/i);
});


test("16 Days campaign is upcoming and then current only within its official date range", () => {
  const slug = "sixteen-days-activism-gender-based-violence-2026";
  const arabic = EVENT_EXTRAS.find((event) => event.slug === slug);
  const english = EN_EVENTS.find((event) => event.slug === slug);
  assert.ok(arabic, "Arabic 16 Days event is missing");
  assert.ok(english, "English 16 Days event is missing");
  assert.equal(arabic.dateIso, "2026-11-25");
  assert.equal(arabic.endDateIso, "2026-12-10");
  assert.equal(english.date, "2026-11-25");
  assert.equal(english.endDate, "2026-12-10");
  assert.equal(arabic.dateLabel, "25 نوفمبر – 10 ديسمبر 2026");
  assert.equal(english.dateLabel, "25 November – 10 December 2026");
  assert.match(arabic.paragraphs.join(" "), /الحالة بتاريخ 25 نوفمبر 2026: جارية، بدأت اليوم/);
  assert.match(english.body.join(" "), /Status as of 25 November 2026: ongoing; it began today/);
  assert.doesNotMatch(arabic.paragraphs.join(" "), /الحالة بتاريخ 24 نوفمبر 2026: قادمة/);
  assert.doesNotMatch(english.body.join(" "), /Status as of 24 November 2026: upcoming/);
  assert.deepEqual(sourceUrls(arabic), sourceUrls(english));
  assert.ok(arabic.sources.some((source) => source.href.includes("who.int/campaigns/16-days-of-activism-against-gender-based-violence/2026")));
  assert.ok(arabic.sources.some((source) => source.href.includes("unwomen.org/sites/default/files/2026-08")));
  assert.equal(isEventCurrent(arabic, "2026-11-24"), false);
  assert.equal(isEventUpcomingOrCurrent(arabic, "2026-11-24"), true);
  assert.equal(isEventCurrent(arabic, "2026-11-25"), true);
  assert.equal(isEventCurrent(arabic, "2026-12-10"), true);
  assert.equal(isEventUpcomingOrCurrent(arabic, "2026-12-11"), false);
  assert.match(arabic.paragraphs.join(" "), /لا تعلن.*ساعة بداية موحدة/);
  assert.match(english.body.join(" "), /no single start time or time zone/i);
  assert.match(arabic.paragraphs.join(" "), /ضمان العدالة، حماية الناجيات، وإنهاء الإفلات من العقاب/);
  assert.match(english.body.join(" "), /Ensure Justice, Protect Survivors, End Impunity/);
});


test("24 November Gaza meningitis alert keeps Ministry and OCHA surveillance windows distinct in both languages", () => {
  const slug = "gaza-meningitis-epidemic-alert-2026";
  const arabic = NEWS_ITEMS.find((item) => item.slug === slug);
  const english = EN_NEWS.find((item) => item.slug === slug);
  assert.ok(arabic, "Arabic Gaza meningitis briefing is missing");
  assert.ok(english, "English Gaza meningitis briefing is missing");
  assert.equal(arabic.dateIso, "2026-11-24");
  assert.equal(english.date, "24 November 2026");
  assert.equal(dateNumbers(arabic.contextDateLabel), dateNumbers(english.contextDateLabel));
  assert.match(arabic.contextDateLabel, /11:24/);
  assert.match(english.contextDateLabel, /11:24/);
  assert.deepEqual(sourceUrls(arabic), sourceUrls(english));
  for (const domain of ["wafa.ps", "aa.com.tr", "aljazeera.com", "ochaopt.org"]) {
    assert.ok(arabic.sources.some((source) => source.href.includes(domain)), `Missing source ${domain}`);
  }
  assert.match(arabic.paragraphs.join(" "), /272 إصابة/);
  assert.match(english.body.join(" "), /272 infections/);
  assert.match(arabic.paragraphs.join(" "), /413 حالة محتملة/);
  assert.match(english.body.join(" "), /413 probable cases/);
  assert.match(arabic.paragraphs.join(" "), /لا تُجمع الأرقام ولا تُعامل كإحصاء واحد/);
  assert.match(english.body.join(" "), /should not be added or treated as one dataset/i);
});

test("Cuba's WHO release and the 16 Days event use direct official WHO pages", () => {
  const cuba = NEWS_ITEMS.find((item) => item.slug === "cuba-who-immunization-support-2026");
  const eventAr = EVENT_EXTRAS.find((item) => item.slug === "sixteen-days-activism-gender-based-violence-2026");
  const eventEn = EN_EVENTS.find((item) => item.slug === "sixteen-days-activism-gender-based-violence-2026");
  assert.ok(cuba);
  assert.ok(eventAr);
  assert.ok(eventEn);
  assert.ok(cuba.sources.some((source) => source.href === "https://www.who.int/news/item/24-11-2026-who-director-general--announces-support-for-vaccines--medical-equipment-during-official-visit-to-cuba"));
  assert.ok(eventAr.sources.some((source) => source.href === "https://www.who.int/campaigns/16-days-of-activism-against-gender-based-violence/2026"));
  assert.ok(eventEn.sources.some((source) => source.href === "https://www.who.int/campaigns/16-days-of-activism-against-gender-based-violence/2026"));
  assert.deepEqual(sourceUrls(eventAr), sourceUrls(eventEn));
});


test("26 November Bank of England Financial Stability Report is bilingual, source-matched and preserves the report's risk qualifiers", () => {
  const slug = "bank-of-england-ai-financing-financial-stability-quantum-risk-2026";
  const arabic = NEWS_ITEMS.find((item) => item.slug === slug);
  const english = EN_NEWS.find((item) => item.slug === slug);
  assert.ok(arabic, "Arabic Bank of England briefing is missing");
  assert.ok(english, "English Bank of England briefing is missing");
  assert.equal(arabic.dateIso, "2026-11-26");
  assert.equal(english.date, "26 November 2026");
  assert.equal(dateNumbers(arabic.contextDateLabel), dateNumbers(english.contextDateLabel));
  assert.match(arabic.contextDateLabel, /لا تعرض الصفحة ساعة النشر/);
  assert.match(english.contextDateLabel, /no publication time/i);
  assert.deepEqual(sourceUrls(arabic), sourceUrls(english));
  assert.equal(arabic.paragraphs.length, english.body.length);
  assert.ok(arabic.paragraphs.length >= 5);
  assert.ok(arabic.sources.some((source) => source.href === "https://www.bankofengland.co.uk/financial-stability-report/2026/november-2026"));
  assert.ok(arabic.sources.some((source) => source.href === "https://www.wsj.com/world/uk/boe-warns-scale-and-breadth-of-ai-financing-poses-threat-to-financial-stability-005ad739"));
  assert.match(arabic.paragraphs.join(" "), /305 مليارات دولار/);
  assert.match(english.body.join(" "), /US\$305 billion/);
  assert.match(arabic.paragraphs.join(" "), /التشفير المقاوم للحوسبة الكمّية/);
  assert.match(english.body.join(" "), /quantum-resistant cryptography/);
  assert.match(arabic.paragraphs.join(" "), /النظام المالي البريطاني ظل صامداً/);
  assert.match(english.body.join(" "), /UK financial system remained resilient/);
});
