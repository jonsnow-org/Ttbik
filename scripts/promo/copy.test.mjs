import test from "node:test";
import assert from "node:assert/strict";
import { loadProjects } from "./common.mjs";
import { buildCampaign, renderCampaign } from "./copy.mjs";

const projects = loadProjects().filter((p) => p.id !== "athar");
const BANNED = /\b(profit|profits|earn|earnings|returns?|guaranteed|passive income)\b|أرباح|ربح|عائد|مضمون/i;

test("every non-protected project receives all four platform copy formats", () => {
  assert.ok(projects.length >= 8);
  for (const p of projects) {
    const pack = buildCampaign(p);
    assert.ok(pack.telegram.includes(pack.pageUrl), p.id);
    assert.ok(pack.instagram.includes(pack.pageUrl), p.id);
    assert.ok(pack.tiktok.includes(pack.pageUrl), p.id);
    assert.ok(pack.youtubeTitle.length <= 100, p.id);
    assert.ok(pack.youtubeDescription.includes(pack.pageUrl), p.id);
    assert.doesNotMatch(renderCampaign(p), BANNED, p.id);
  }
});

test("coin-channel copy is English-only", () => {
  for (const p of projects.filter((p) => p.channel === "coins")) {
    const pack = renderCampaign(p);
    assert.doesNotMatch(pack, /[؀-ۿ]/, p.id);
  }
});

test("general-channel copy leads with English and then includes Arabic", () => {
  for (const p of projects.filter((p) => p.channel !== "coins")) {
    const pack = buildCampaign(p);
    assert.ok(pack.telegram.indexOf(p.tagline[0]) < pack.telegram.indexOf(p.tagline[1]), p.id);
  }
});
