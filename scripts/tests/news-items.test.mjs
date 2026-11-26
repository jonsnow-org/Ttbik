import test from "node:test";
import assert from "node:assert/strict";
import { NEWS_ITEMS, getNewsItem, latestNewsItem, newsSitemapEntries } from "../../src/lib/newsItems.ts";
import { EN_NEWS } from "../../src/lib/enDesk.ts";

test("news catalogue is real, non-empty, and contains unique slugs", () => {
  assert.ok(NEWS_ITEMS.length >= 5);
  assert.ok(NEWS_ITEMS.every((item) => item && typeof item.slug === "string" && item.slug.length > 0));
  assert.equal(new Set(NEWS_ITEMS.map((item) => item.slug)).size, NEWS_ITEMS.length);
});

test("latest news entry and public sitemap exports are usable", () => {
  const newest = [...NEWS_ITEMS].sort((a, b) => (b.updatedDateIso || b.dateIso).localeCompare(a.updatedDateIso || a.dateIso))[0];
  assert.equal(latestNewsItem()?.slug, newest.slug);
  assert.equal(getNewsItem("us-midterms-2026-democrats-gains-nov")?.dateIso, "2026-11-04");
  assert.equal(newsSitemapEntries().length, NEWS_ITEMS.length);
  assert.ok(newsSitemapEntries().every((item) => item.path.startsWith("/news/")));
  const cop31 = NEWS_ITEMS.find((item) => item.slug === "cop31-overtime-climate-talks-2026");
  const cop31Sitemap = newsSitemapEntries().find((item) => item.path.endsWith(cop31?.slug || ""));
  assert.equal(cop31?.dateIso, "2026-11-21");
  assert.equal(cop31?.updatedDateIso, "2026-11-23");
  assert.equal(cop31Sitemap?.dateIso, cop31?.dateIso, "news sitemap must retain the original publication date");
});


test("25 November news has matching Arabic and English slugs, dates, source URLs and paragraph counts", () => {
  for (const slug of [
    "us-section-301-proposed-tariffs-14-economies-2026",
    "us-q3-gdp-pce-inflation-october-2026",
    "libya-benghazi-naval-officers-drone-attack-2026"
  ]) {
    const ar = getNewsItem(slug);
    const en = EN_NEWS.find((item) => item.slug === slug);
    assert.ok(ar, `missing Arabic news item: ${slug}`);
    assert.ok(en, `missing English news item: ${slug}`);
    assert.equal(ar.dateIso, "2026-11-25");
    assert.equal(en.date, "25 November 2026");
    assert.deepEqual(
      ar.sources.map((source) => source.href).sort(),
      (en.sources || []).map((source) => source.href).sort(),
      `${slug}: source URLs must match in both languages`
    );
    assert.equal(ar.paragraphs.length, en.body.length, `${slug}: paragraph counts must match`);
  }
});

test("26 November news has matching Arabic and English slugs, dates, source URLs and paragraph counts", () => {
  for (const slug of [
    "dr-congo-bundibugyo-ebola-outbreak-12021-cases-2026",
    "uk-net-migration-june-2026-77000",
    "taiwan-ntu-on-device-generative-ai-chips-2026",
    "south-korea-bok-rate-hike-growth-outlook-2026"
  ]) {
    const ar = getNewsItem(slug);
    const en = EN_NEWS.find((item) => item.slug === slug);
    assert.ok(ar, `missing Arabic news item: ${slug}`);
    assert.ok(en, `missing English news item: ${slug}`);
    assert.equal(ar.dateIso, "2026-11-26");
    assert.equal(en.date, "26 November 2026");
    assert.deepEqual(
      ar.sources.map((source) => source.href).sort(),
      (en.sources || []).map((source) => source.href).sort(),
      `${slug}: source URLs must match in both languages`
    );
    assert.equal(ar.paragraphs.length, en.body.length, `${slug}: paragraph counts must match`);
    assert.ok(ar.sources.length >= 2 && (en.sources || []).length >= 2);
  }
});
