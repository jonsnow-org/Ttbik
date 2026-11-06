#!/usr/bin/env node
// Content size check: exits 1 if a content file under src/lib is emptied, holds placeholder text,
// or shrinks by more than 50% compared with a base ref. Read-only; changes nothing.
//   node scripts/content-shrink-check.mjs            # compares the working tree with HEAD
//   node scripts/content-shrink-check.mjs origin/claude/free-services-marketplace-h6rwk2
// Background: on 2026-10-21 commit 8d111d08 emptied these 4 files and the production build failed.
// On 2026-11-06 the daily-news automation wrote the literal shell text `$(cat /tmp/..._updated.ts)` into
// newsItems.ts and enDesk.ts (unquoted heredoc), which breaks the build while keeping ~1 line, so a size
// check alone does not catch it: a file that is not a module (no `export`) is also rejected below.
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
/** A .ts content module must export something; a shell-expansion artifact (`$(cat …)`) or any other
 *  non-module stub leaves the file syntactically empty and the build fails. */
const isModule = (t) => /\bexport\b/.test(t);
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
  const shellArtifact = /^\s*\$\(/.test(after) || !isModule(after);
  if (!after.trim() || shrunk || placeholder || shellArtifact) {
    bad++;
    const why = placeholder ? " (placeholder text)" : shellArtifact ? " (not a module: shell expansion / no export)" : "";
    console.error(`✗ ${f}: ${b} → ${a} lines${why}`);
  } else {
    console.log(`✓ ${f}: ${b} → ${a} lines`);
  }
}
if (bad) {
  console.error(`\n${bad} content file(s) emptied, shrunk by more than 50%, or not a module.`);
  process.exit(1);
}
