// Guards the single promo catalog: every campaign is catalogued, every catalog item has a campaign, the ledger is valid.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { loadProjects } from "./common.mjs";
import { buildHandoff } from "./handoff.mjs";

const catalog = JSON.parse(fs.readFileSync("promo/catalog.json", "utf8"));
const ledger = JSON.parse(fs.readFileSync("promo/handoff/LEDGER.json", "utf8")).entries;
const ids = new Set(loadProjects().map((p) => p.id));
const PLATFORMS = new Set(["instagram", "tiktok", "facebook", "x"]);

test("every campaign is in the catalog and every catalog product has a campaign", () => {
  const cat = new Set(catalog.products.map((p) => p.campaign));
  for (const id of ids) assert.ok(cat.has(id), `campaign not in promo/catalog.json: ${id}`);
  for (const p of catalog.products) assert.ok(ids.has(p.campaign), `catalog product without campaign: ${p.id}`);
  assert.equal(new Set(catalog.products.map((p) => p.id)).size, catalog.products.length);
});

test("handoff platforms are known and the coins project is never sent to Instagram/Facebook/TikTok in Arabic", () => {
  for (const p of catalog.products) for (const pl of p.handoff) assert.ok(PLATFORMS.has(pl), `${p.id}: ${pl}`);
  const projects = Object.fromEntries(loadProjects().map((p) => [p.id, p]));
  for (const p of catalog.products.filter((x) => projects[x.campaign]?.channel === "coins")) {
    assert.deepEqual(p.handoff.filter((pl) => pl !== "x"), [], `${p.id}: coins material goes to X only (English)`);
  }
});

test("ledger entries are well formed and refer to catalog products", () => {
  const known = new Set(catalog.products.map((p) => p.id));
  for (const e of ledger) {
    assert.ok(known.has(e.id) && PLATFORMS.has(e.platform) && /^\d{4}-\d{2}-\d{2}$/.test(e.date), JSON.stringify(e));
  }
});

test("handoff sheet builds, lists work to do and carries no earnings promise", () => {
  const { markdown, todo } = buildHandoff("2026-11-15");
  assert.ok(todo.length > 0);
  assert.doesNotMatch(markdown, /\b(guaranteed|passive income)\b|أرباح مضمونة|ربح مضمون/i);
});

test("promo sources do not point at the retired site domain", () => {
  for (const f of ["scripts/promo/projects.json", "promo/catalog.json", "promo/platform-features.json"]) {
    assert.doesNotMatch(fs.readFileSync(f, "utf8"), /ttbik\.vercel\.app/, f);
  }
});
