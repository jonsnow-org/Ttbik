import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import {
  narrationText,
  projectLanguage,
} from "../promo/common.mjs";
import { buildCampaign, renderCampaign } from "../promo/copy.mjs";
import { chooseCampaign, PUBLISHABLE_CAMPAIGN_IDS } from "../promo/rotation.mjs";

const projects = JSON.parse(fs.readFileSync("scripts/promo/projects.json", "utf8")).projects;
const pair = (x) => Array.isArray(x) && x.length === 2 && x.every((s) => typeof s === "string" && s.trim());
const BANNED = /\b(profit|profits|earn|earnings|returns?|guaranteed|passive income)\b|أرباح|ربح|عائد|مضمون/i;
const EXCLUDED_PUBLIC_BOTS = new Set(["ads-and-earn", "medical"]);

test("promo generator files parse", () => {
  for (const file of [
    "scripts/promo/make.mjs",
    "scripts/promo/cards.mjs",
    "scripts/promo/copy.mjs",
  ]) {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  }
});

test("every campaign is complete and has an image or monogram identity", () => {
  assert.ok(projects.length >= 9);
  for (const p of projects) {
    assert.match(p.id, /^[a-z0-9-]+$/);
    assert.ok(pair(p.tagline) && pair(p.cta), `${p.id}: tagline/cta`);
    assert.ok(Array.isArray(p.points) && p.points.length >= 2 && p.points.every(pair), `${p.id}: points`);
    assert.ok(Array.isArray(p.shots) && p.shots.every((s) => pair(s.caption) && (s.url || s.path)), `${p.id}: shots`);
    assert.ok(Array.isArray(p.bg) && p.bg.length === 2 && /^#[0-9a-f]{6}$/i.test(p.accent), `${p.id}: colours`);
    assert.ok(p.handle && p.name, `${p.id}: name/handle`);
    assert.ok(p.logo ? fs.existsSync(p.logo) : typeof p.brandMark === "string" && p.brandMark.trim(), `${p.id}: logo or brand mark`);
    assert.ok(/[A-Za-z]/.test(p.tagline[0]) && /[؀-ۿ]/.test(p.tagline[1]), `${p.id}: English then Arabic`);
  }
});

test("campaigns contain no promise of profit or financial return", () => {
  for (const p of projects) {
    const copy = [p.name, ...p.tagline, ...p.cta, ...p.points.flat(), ...p.shots.flatMap((s) => s.caption)].join(" | ");
    assert.ok(!BANNED.test(copy), `${p.id}: prohibited claim in campaign copy`);
  }
});

test("all public bot landing pages are covered or explicitly excluded for review", () => {
  const source = fs.readFileSync("src/lib/botLanding.ts", "utf8");
  const slugs = [...source.matchAll(/slug:\s*"([^"]+)"/g)].map((m) => m[1]);
  const covered = new Set(projects.map((p) => p.botLanding).filter(Boolean));
  assert.deepEqual(slugs.filter((slug) => !covered.has(slug) && !EXCLUDED_PUBLIC_BOTS.has(slug)), []);
  for (const slug of EXCLUDED_PUBLIC_BOTS) assert.ok(slugs.includes(slug), `stale exclusion: ${slug}`);
});

test("coin-channel campaign video and copy are English-only", () => {
  for (const p of projects.filter((p) => p.channel === "coins")) {
    assert.equal(projectLanguage(p), "en", p.id);
    assert.doesNotMatch(narrationText(p), /[؀-ۿ]/, p.id);
    assert.doesNotMatch(renderCampaign(p), /[؀-ۿ]/, p.id);
  }
});

test("every non-protected project receives all four platform copy formats", () => {
  const publicProjects = projects.filter((p) => p.id !== "athar");
  assert.ok(publicProjects.length >= 8);
  for (const p of publicProjects) {
    const pack = buildCampaign(p);
    assert.ok(pack.telegram.includes(pack.pageUrl), `${p.id}: Telegram URL`);
    assert.ok(pack.instagram.includes(pack.pageUrl), `${p.id}: Instagram URL`);
    assert.ok(pack.tiktok.includes(pack.pageUrl), `${p.id}: TikTok URL`);
    assert.ok(pack.youtubeTitle.length <= 100, `${p.id}: YouTube title limit`);
    assert.ok(pack.youtubeDescription.includes(pack.pageUrl), `${p.id}: YouTube description URL`);
    assert.doesNotMatch(renderCampaign(p), BANNED, p.id);
  }
});

test("general-channel copy leads with English and then includes Arabic", () => {
  for (const p of projects.filter((p) => p.id !== "athar" && p.channel !== "coins")) {
    const pack = buildCampaign(p);
    assert.ok(pack.telegram.indexOf(p.tagline[0]) < pack.telegram.indexOf(p.tagline[1]), p.id);
  }
});

test("Athar is omitted from the new copy pack and remains on the old silent-render path", () => {
  const athar = projects.find((p) => p.id === "athar");
  assert.ok(athar);
  const copySource = fs.readFileSync("scripts/promo/copy.mjs", "utf8");
  const videoSource = fs.readFileSync("scripts/promo/make.mjs", "utf8");
  assert.match(copySource, /new Set\(\["athar"\]\)/);
  assert.match(videoSource, /if \(p\.id !== "athar"\)/);
  assert.equal(projectLanguage(athar), "both");
});

test("weekly auto-publisher rotates only campaigns not owned by the old Remotion episodes", () => {
  const ids = PUBLISHABLE_CAMPAIGN_IDS;
  assert.deepEqual(ids, ["sham-ai", "literium", "media-downloader", "jobs-and-store", "dating-marriage", "confessions"]);
  assert.equal(chooseCampaign({ date: "2026-11-16" }).id, "sham-ai");
  assert.equal(chooseCampaign({ date: "2026-11-23" }).id, "literium");
  for (const excluded of ["athar", "zenobia", "palmyra-launch"]) {
    assert.ok(!ids.includes(excluded), excluded);
    assert.throws(() => chooseCampaign({ date: "2026-11-16", only: excluded }), /unknown or excluded/);
  }
});

test("old and new video publishers have distinct release namespaces and calendars", () => {
  const oldFlow = fs.readFileSync(".github/workflows/promo-remotion.yml", "utf8");
  const newFlow = fs.readFileSync(".github/workflows/promo-projects.yml", "utf8");
  const route = fs.readFileSync("src/app/api/cron/promo-publish/route.ts", "utf8");
  const publisher = fs.readFileSync("scripts/promo/publish.mjs", "utf8");
  assert.match(oldFlow, /promo-ep-\$ID/);
  assert.match(oldFlow, /0 7 \* \* 0,2,4/);
  assert.match(newFlow, /40 3 \* \* 1/);
  assert.match(newFlow, /scripts\/promo\/publish\.mjs/);
  assert.match(newFlow, /PUBLISH_ON/);
  assert.match(publisher, /promo-campaign-/);
  assert.match(publisher, /published-telegram-/);
  assert.match(publisher, /published-youtube\.json/);
  assert.match(route, /promo-campaign-/);
  assert.ok(fs.existsSync("promo/PUBLISH_ON"), "the owner publish switch must remain enabled");
});

test("YouTube publishing uses the site's existing OAuth gate and never needs a new paid service", () => {
  const youtube = fs.readFileSync("src/lib/youtubePublish.ts", "utf8");
  const publisher = fs.readFileSync("scripts/promo/publish.mjs", "utf8");
  assert.match(youtube, /youtubeReady/);
  assert.match(youtube, /youtube_publish_refresh_token/);
  assert.match(publisher, /to=\\"youtube\\"/);
  assert.match(publisher, /YouTube upload not completed/);
});
