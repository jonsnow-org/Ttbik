// Guards projects.json (the source of the promo videos and images): every entry complete, bilingual, logo present, no earnings language.
// Run: node --test scripts/promo/projects.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const projects = JSON.parse(fs.readFileSync("scripts/promo/projects.json", "utf8")).projects;
const pair = (x) => Array.isArray(x) && x.length === 2 && x.every((s) => typeof s === "string" && s.trim());
const BANNED = /\b(profit|profits|earn|earnings|returns?|guaranteed|passive income)\b|أرباح|ربح|عائد|مضمون/i;

test("every project is complete and bilingual (English first, Arabic second)", () => {
  assert.ok(projects.length >= 5);
  for (const p of projects) {
    assert.match(p.id, /^[a-z0-9-]+$/);
    assert.ok(pair(p.tagline) && pair(p.cta), `${p.id}: tagline/cta`);
    assert.ok(p.points.length >= 2 && p.points.every(pair), `${p.id}: points`);
    assert.ok(p.shots.every((s) => pair(s.caption) && (s.url || s.path)), `${p.id}: shots`);
    assert.ok(Array.isArray(p.bg) && p.bg.length === 2 && /^#[0-9a-f]{6}$/i.test(p.accent), `${p.id}: colours`);
    assert.ok(p.handle && p.name, `${p.id}: name/handle`);
    assert.ok(fs.existsSync(p.logo), `${p.id}: logo file ${p.logo}`);
    assert.ok(/[A-Za-z]/.test(p.tagline[0]) && /[؀-ۿ]/.test(p.tagline[1]), `${p.id}: English first, Arabic second`);
  }
});

test("no promise of profit or return in any promo text", () => {
  for (const p of projects) {
    const text = [p.name, ...p.tagline, ...p.cta, ...p.points.flat(), ...p.shots.flatMap((s) => s.caption)].join(" | ");
    assert.ok(!BANNED.test(text), `${p.id}: earnings language in "${text.match(BANNED)?.[0]}"`);
  }
});

test("project ids are unique", () => {
  assert.equal(new Set(projects.map((p) => p.id)).size, projects.length);
});
