import test from "node:test";
import assert from "node:assert/strict";
import { NEWS_ITEMS, getNewsItem, latestNewsItem, newsSitemapEntries } from "../../src/lib/newsItems.ts";

test("news catalogue is real, non-empty, and contains unique slugs", () => {
  assert.ok(NEWS_ITEMS.length >= 5);
  assert.ok(NEWS_ITEMS.every((item) => item && typeof item.slug === "string" && item.slug.length > 0));
  assert.equal(new Set(NEWS_ITEMS.map((item) => item.slug)).size, NEWS_ITEMS.length);
});

test("latest news entry and public sitemap exports are usable", () => {
  // not tied to one day's story: the daily news automation adds a newer item every day
  const latest = latestNewsItem();
  assert.ok(latest && latest.slug);
  assert.equal(getNewsItem(latest.slug)?.slug, latest.slug);
  assert.ok(NEWS_ITEMS.every((item) => item.dateIso <= latest.dateIso), "latest is the newest item");
  assert.equal(newsSitemapEntries().length, NEWS_ITEMS.length);
  assert.ok(newsSitemapEntries().every((item) => item.path.startsWith("/news/")));
});
