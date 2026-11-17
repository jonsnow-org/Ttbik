import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NEWS_ITEMS } from "../../src/lib/newsItems.ts";
import { ARTICLE_ITEMS } from "../../src/lib/articlesIndex.ts";
import { EVENT_EXTRAS, isEventUpcomingOrCurrent } from "../../src/lib/eventsExtra.ts";
import { EN_NEWS, EN_ARTICLES, EN_EVENTS, isUpcomingDate } from "../../src/lib/enDesk.ts";

const NEWS_SLUG = "openai-for-chile-public-sector-ai-2026";
const ARTICLE_SLUG = "government-ai-partnership-checklist";
const EVENT_SLUG = "apec-economic-leaders-meeting-shenzhen-2026";
const sourceUrls = (item) => (item?.sources || []).map((source) => source.href).sort();

test("daily news has source-matched Arabic and English versions", () => {
  const ar = NEWS_ITEMS.find((item) => item.slug === NEWS_SLUG);
  const en = EN_NEWS.find((item) => item.slug === NEWS_SLUG);
  assert.ok(ar, "Arabic news entry is missing");
  assert.ok(en, "English news entry is missing");
  assert.equal(ar.dateIso, en.date);
  assert.deepEqual(sourceUrls(ar), sourceUrls(en));
  assert.ok(ar.sources.length >= 2);
  assert.match(ar.description, /مذكرة تفاهم/);
  assert.match(en.dek, /memorandum/);
});


test("the wider global news briefings are bilingual and independently sourced", () => {
  for (const slug of ["japan-russian-airspace-incident-2026", "china-mexico-cooperation-apec-2026", "us-remote-ai-chip-controls-2026"]) {
    const ar = NEWS_ITEMS.find((item) => item.slug === slug);
    const en = EN_NEWS.find((item) => item.slug === slug);
    assert.ok(ar, `Arabic news entry missing: ${slug}`);
    assert.ok(en, `English news entry missing: ${slug}`);
    assert.equal(ar.dateIso, en.date);
    assert.deepEqual(sourceUrls(ar), sourceUrls(en));
    assert.ok(ar.sources.length >= 2);
  }
});

test("the practical guide is bilingual and cites the same governance sources", () => {
  const ar = ARTICLE_ITEMS.find((item) => item.slug === ARTICLE_SLUG);
  const en = EN_ARTICLES.find((item) => item.slug === ARTICLE_SLUG);
  assert.ok(ar, "Arabic guide is missing");
  assert.ok(en, "English guide is missing");
  assert.equal(ar.dateIso, en.date);
  assert.deepEqual(sourceUrls(ar), sourceUrls(en));
  assert.ok(ar.paragraphs.length >= 6);
  assert.ok(ar.takeaways.length >= 3);
});

test("the APEC event remains current through its final day in both locales", () => {
  const ar = EVENT_EXTRAS.find((item) => item.slug === EVENT_SLUG);
  const en = EN_EVENTS.find((item) => item.slug === EVENT_SLUG);
  assert.ok(ar, "Arabic event is missing");
  assert.ok(en, "English event is missing");
  assert.equal(ar.dateIso, en.date);
  assert.equal(ar.endDateIso, en.endDate);
  assert.deepEqual(sourceUrls(ar), sourceUrls(en));
  for (const day of ["2026-11-17", "2026-11-18", "2026-11-19"]) {
    assert.equal(isUpcomingDate(en, day), true, `English event missing on ${day}`);
    assert.equal(isEventUpcomingOrCurrent(ar, day), true, `Arabic event missing on ${day}`);
  }
  assert.equal(isUpcomingDate(en, "2026-11-20"), false);
  assert.equal(isEventUpcomingOrCurrent(ar, "2026-11-20"), false);
});

test("English covers fall back to the site's editorial image when a slug has no custom cover", () => {
  const root = process.cwd();
  const component = readFileSync(path.join(root, "src/components/EnglishStoryCard.tsx"), "utf8");
  assert.match(component, /COVERS\\[slug\\] \\|\\| \`\\$\\{SITE_URL\\}\\/og\\/news\\.jpg\`/);
});

test("English editorial detail pages render source links and matching locale alternates", () => {
  const root = process.cwd();
  const checks = [
    ["src/app/en/news/[slug]/page.tsx", /item\.sources\?\.length/, /languages:/],
    ["src/app/en/articles/[slug]/page.tsx", /item\.sources\?\.length/, /languages:/],
    ["src/app/en/events/[slug]/page.tsx", /item\.sources\?\.length/, /languages:/],
  ];
  for (const [file, sources, languages] of checks) {
    const content = readFileSync(path.join(root, file), "utf8");
    assert.match(content, sources, `${file} does not render sources`);
    assert.match(content, languages, `${file} does not expose locale alternates`);
  }
});
