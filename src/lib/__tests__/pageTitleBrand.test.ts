// The root layout adds « | شام AI» to every page title (title.template). A page whose own title already ends with the
// brand showed it twice in search results and tabs («… | شام AI | شام AI», 60+ pages on 2026-11-10).
// Rule: a plain page title must not carry the brand; a page that wants the full text uses { absolute } (toolMeta does).
import fs from "fs";
import path from "path";

const APP = path.join(__dirname, "..", "..", "app");
// /remit is being edited on another branch; its title is fixed there.
const PENDING = new Set(["remit/page.tsx"]);

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "en" || e.name === "api" ? [] : files(p);
    return /^(page\.tsx|.*Meta\.ts)$/.test(e.name) ? [p] : [];
  });
}

// The first key of the metadata object (`export const metadata = {` or `return {` in generateMetadata).
const TOP_TITLE = /(?:export const metadata[^=]*=\s*\{|return\s*\{|export const \w+Meta[^=]*=\s*\{)\s*title:\s*(["`])([^"`\n]*)\1/g;

describe("page titles do not repeat the brand", () => {
  it("no plain top-level title ends with «شام AI»", () => {
    const bad: string[] = [];
    for (const f of files(APP)) {
      const rel = path.relative(APP, f);
      if (PENDING.has(rel)) continue;
      const src = fs.readFileSync(f, "utf8");
      for (const m of src.matchAll(TOP_TITLE)) if (/[|—-]\s*شام AI\s*$/.test(m[2])) bad.push(`${rel}: ${m[2]}`);
    }
    expect(bad).toEqual([]);
  });
});
