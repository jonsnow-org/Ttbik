import test from "node:test";
import assert from "node:assert/strict";
import { chooseCampaign, eligibleCampaigns, PUBLISHABLE_CAMPAIGN_IDS } from "./rotation.mjs";

test("weekly rotation includes only the new pipeline's six non-overlapping campaigns", () => {
  assert.deepEqual(eligibleCampaigns().map((p) => p.id), PUBLISHABLE_CAMPAIGN_IDS);
  assert.ok(!PUBLISHABLE_CAMPAIGN_IDS.includes("athar"));
  assert.ok(!PUBLISHABLE_CAMPAIGN_IDS.includes("zenobia"));
  assert.ok(!PUBLISHABLE_CAMPAIGN_IDS.includes("palmyra-launch"));
});

test("first weekly slot is deterministic and emits a release tag separate from Remotion episodes", () => {
  const first = chooseCampaign({ date: "2026-11-16" });
  assert.equal(first.id, "sham-ai");
  assert.equal(first.tag, "promo-campaign-sham-ai-20261116");
  assert.equal(first.channel, "general");
  assert.equal(first.asset, "sham-ai-vertical.mp4");
  assert.match(first.tag, /^promo-campaign-/);
  assert.doesNotMatch(first.tag, /^promo-ep-/);
});

test("rotation advances one campaign every seven days and wraps", () => {
  assert.equal(chooseCampaign({ date: "2026-11-23" }).id, "literium");
  assert.equal(chooseCampaign({ date: "2026-12-28" }).id, "sham-ai");
});

test("manual campaign override only accepts an eligible campaign", () => {
  assert.equal(chooseCampaign({ date: "2026-11-16", only: "confessions" }).id, "confessions");
  assert.throws(() => chooseCampaign({ date: "2026-11-16", only: "athar" }), /unknown or excluded/);
  assert.throws(() => chooseCampaign({ date: "16-11-2026" }), /invalid campaign date/);
});
