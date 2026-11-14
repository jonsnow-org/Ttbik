// Guards project and public-bot campaign coverage, language rules and promotional claims.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { projectLanguage, narrationText } from "./common.mjs";

const projects = JSON.parse(fs.readFileSync("scripts/promo/projects.json", "utf8")).projects;
const pair = (x) => Array.isArray(x) && x.length === 2 && x.every((s) => typeof s === "string" && s.trim());
const BANNED = /\b(profit|profits|earn|earnings|returns?|guaranteed|passive income)\b|أرباح|ربح|عائد|مضمون/i;
const EXCLUDED_PUBLIC_BOTS = new Set(["ads-and-earn", "medical"]); // income claims / health-related service: manual review required

test("every project is complete, with a bilingual identity and valid visual assets", () => {
  assert.ok(projects.length >= 9);
  for (const p of projects) {
    assert.match(p.id, /^[a-z0-9-]+$/);
    assert.ok(pair(p.tagline) && pair(p.cta), `${p.id}: tagline/cta`);
    assert.ok(p.points.length >= 2 && p.points.every(pair), `${p.id}: points`);
    assert.ok(p.shots.every((s) => pair(s.caption) && (s.url || s.path)), `${p.id}: shots`);
    assert.ok(Array.isArray(p.bg) && p.bg.length === 2 && /^#[0-9a-f]{6}$/i.test(p.accent), `${p.id}: colours`);
    assert.ok(p.handle && p.name, `${p.id}: name/handle`);
    assert.ok(p.logo ? fs.existsSync(p.logo) : typeof p.brandMark === "string" && p.brandMark.trim(), `${p.id}: logo or brand mark`);
    assert.ok(/[A-Za-z]/.test(p.tagline[0]) && /[؀-ۿ]/.test(p.tagline[1]), `${p.id}: English first, Arabic second`);
  }
});

test("no promise of profit or return in any promo text", () => {
  for (const p of projects) {
    const text = [p.name, ...p.tagline, ...p.cta, ...p.points.flat(), ...p.shots.flatMap((s) => s.caption)].join(" | ");
    assert.ok(!BANNED.test(text), `${p.id}: earnings language in "${text.match(BANNED)?.[0]}"`);
  }
});

test("the selected report products are included in the campaign rotation", () => {
  const ids = new Set(projects.map((p) => p.id));
  for (const id of ["marriage-trust", "channel-exchange", "group-khatma", "group-contests"]) assert.ok(ids.has(id), `missing campaign: ${id}`);
});

test("project ids are unique", () => {
  assert.equal(new Set(projects.map((p) => p.id)).size, projects.length);
});

test("every public bot landing is promoted or explicitly excluded for review", () => {
  const source = fs.readFileSync("src/lib/botLanding.ts", "utf8");
  const slugs = [...source.matchAll(/slug:\s*"([^"]+)"/g)].map((m) => m[1]);
  const covered = new Set(projects.map((p) => p.botLanding).filter(Boolean));
  const uncovered = slugs.filter((slug) => !covered.has(slug) && !EXCLUDED_PUBLIC_BOTS.has(slug));
  assert.deepEqual(uncovered, []);
  for (const excluded of EXCLUDED_PUBLIC_BOTS) assert.ok(slugs.includes(excluded), `stale exclusion: ${excluded}`);
});

test("coin-channel campaigns and narration are English-only", () => {
  for (const p of projects.filter((project) => project.channel === "coins")) {
    assert.equal(projectLanguage(p), "en", p.id);
    assert.doesNotMatch(narrationText(p), /[؀-ۿ]/, p.id);
  }
});
