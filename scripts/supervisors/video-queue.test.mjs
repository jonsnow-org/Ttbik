import test from "node:test";
import assert from "node:assert/strict";
import { assessVideoQueue } from "./video-queue.mjs";

const NOW = Date.parse("2026-11-26T21:00:00Z");
const ep = (id, extra = {}) => ({ id, ...extra });
const release = (id, daysAgo = 1, assets = [
  { name: `sham-ai-ep-${id}.mp4`, size: 1024 },
  { name: `sham-ai-ep-${id}.jpg`, size: 128 },
]) => ({
  tag_name: `promo-ep-${id}`,
  published_at: new Date(NOW - daysAgo * 24 * 3600_000).toISOString(),
  html_url: `release-${id}`,
  assets,
});

test("healthy queue requires recent release assets and three ready episodes", () => {
  const result = assessVideoQueue({
    episodes: [ep(1), ep(2), ep(3), ep(4, { needs: "platform" }), ep(5)],
    releases: [release(1), { tag_name: "promo-2", published_at: new Date(NOW).toISOString() }],
    nowMs: NOW,
  });
  assert.deepEqual(result.readyIds, [2, 3, 5]);
  assert.deepEqual(result.blockedIds, [4]);
  assert.equal(result.checks.find((item) => item.name === "Promo video release freshness").level, "ok");
  assert.equal(result.checks.find((item) => item.name === "Promo video release assets").level, "ok");
  assert.equal(result.checks.find((item) => item.name === "Promo video ready queue").level, "ok");
});

test("a small but non-empty queue warns before it runs dry", () => {
  const result = assessVideoQueue({
    episodes: [ep(1), ep(2), ep(3)],
    releases: [release(1)],
    nowMs: NOW,
  });
  assert.equal(result.readyIds.length, 2);
  assert.equal(result.checks.find((item) => item.name === "Promo video ready queue").level, "warn");
});

test("stale video release fails even when a workflow could be green", () => {
  const result = assessVideoQueue({
    episodes: [ep(2), ep(3), ep(4)],
    releases: [release(1, 14)],
    nowMs: NOW,
  });
  assert.equal(result.checks.find((item) => item.name === "Promo video release freshness").level, "fail");
});

test("missing or empty MP4/JPG assets fail release verification", () => {
  const result = assessVideoQueue({
    episodes: [ep(2), ep(3), ep(4)],
    releases: [release(1, 1, [{ name: "sham-ai-ep-1.mp4", size: 0 }])],
    nowMs: NOW,
  });
  assert.equal(result.checks.find((item) => item.name === "Promo video release assets").level, "fail");
});

test("exhausted and fully gated queues fail instead of looking healthy", () => {
  const exhausted = assessVideoQueue({
    episodes: [ep(1)],
    releases: [release(1)],
    nowMs: NOW,
  });
  assert.equal(exhausted.checks.find((item) => item.name === "Promo video ready queue").level, "fail");

  const gated = assessVideoQueue({
    episodes: [ep(2, { needs: "znbt" })],
    releases: [],
    nowMs: NOW,
  });
  assert.equal(gated.checks.find((item) => item.name === "Promo video ready queue").level, "fail");
  assert.deepEqual(gated.blockedIds, [2]);
});

test("only promo-ep-N releases count toward the video queue", () => {
  const result = assessVideoQueue({
    episodes: [ep(1)],
    releases: [{ tag_name: "promo-1", published_at: new Date(NOW).toISOString() }],
    nowMs: NOW,
  });
  assert.deepEqual(result.pendingIds, [1]);
  assert.equal(result.latestTag, null);
});
