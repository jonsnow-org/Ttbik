#!/usr/bin/env node
// Content size check: exits 1 if a content file under src/lib is emptied, holds placeholder text,
// or shrinks by more than 50% compared with a base ref. Read-only; changes nothing.
//   node scripts/content-shrink-check.mjs            # compares the working tree with HEAD
//   node scripts/content-shrink-check.mjs origin/claude/free-services-marketplace-h6rwk2
// Background: on 2026-10-21 commit 8d111d08 emptied these 4 files and the production build failed.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const base = process.argv[2] || "HEAD";
const FILES = [
  "src/lib/newsItems.ts",
  "src/lib/articlesIndex.ts",
  "src/lib/eventsIndex.ts",
  "src/lib/enDesk.ts",
];
const lines = (t) => (t ? t.split("\n").length : 0);
let bad = 0;
for (const f of FILES) {
  let before = "";
  try {
    before = execFileSync("git", ["show", `${base}:${f}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch {
    continue; // file not in base: nothing to compare
  }
  const after = existsSync(f) ? readFileSync(f, "utf8") : "";
  const b = lines(before);
  const a = lines(after);
  const shrunk = b > 20 && a < b * 0.5;
  const placeholder = /^\s*PLACEHOLDER/i.test(after);
  if (!after.trim() || shrunk || placeholder) {
    bad++;
    console.error(`✗ ${f}: ${b} → ${a} lines${placeholder ? " (placeholder text)" : ""}`);
  } else {
    console.log(`✓ ${f}: ${b} → ${a} lines`);
  }
}
if (bad) {
  console.error(`\n${bad} content file(s) emptied or shrunk by more than 50%.`);
  process.exit(1);
}
