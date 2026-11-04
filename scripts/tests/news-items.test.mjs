import test from "node:test";
import assert from "node:assert/strict";
import { NEWS_ITEMS, getNewsItem, latestNewsItem, newsSitemapEntries } from "../../src/lib/newsItems.ts";

test("news catalogue is real, non-empty, and contains unique slugs", () => {
  assert.ok(NEWS_ITEMS.length >= 5);
  assert.ok(NEWS_ITEMS.every((item) => item && typeof item.slug === "string" && item.slug.length > 0));
  assert.equal(new Set(NEWS_ITEMS.map((item) => item.slug)).size, NEWS_ITEMS.length);
});

test("latest news entry and public sitemap exports are usable", () => {
  assert.equal(latestNewsItem()?.slug, "us-midterms-2026-democrats-gains-nov");
  assert.equal(getNewsItem("us-midterms-2026-democrats-gains-nov")?.dateIso, "2026-11-04");
  assert.equal(newsSitemapEntries().length, NEWS_ITEMS.length);
  assert.ok(newsSitemapEntries().every((item) => item.path.startsWith("/news/")));
});
