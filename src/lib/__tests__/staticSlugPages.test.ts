// A loading.tsx wraps every page below it in <Suspense>, so the response starts streaming as 200 before
// notFound() runs and a missing slug became a soft 404 (dynamicParams = false alone did not help).
// /news, /articles and /events keep their loading screen only for the list page, inside the (index)
// route group, so /<section>/<unknown slug> answers a real 404.
import fs from "fs";
import path from "path";
import { getArticle } from "@/lib/articlesIndex";
import { getNewsItem } from "@/lib/newsItems";
import { getEvent } from "@/lib/eventsIndex";

const APP = path.join(__dirname, "..", "..", "app");
describe("static slug pages answer a real 404", () => {
  it.each(["articles", "events", "news"])("/%s/[slug] refuses unknown slugs before rendering", (seg) => {
    const src = fs.readFileSync(path.join(APP, seg, "[slug]", "page.tsx"), "utf8");
    expect(src).toMatch(/export const dynamicParams = false;/);
    expect(src).toMatch(/export function generateStaticParams/);
    expect(fs.existsSync(path.join(APP, seg, "loading.tsx"))).toBe(false);
    expect(fs.existsSync(path.join(APP, seg, "[slug]", "loading.tsx"))).toBe(false);
    expect(fs.existsSync(path.join(APP, seg, "(index)", "loading.tsx"))).toBe(true);
    expect(fs.existsSync(path.join(APP, seg, "(index)", "page.tsx"))).toBe(true);
  });
  it("no other loading.tsx sits above a page that calls notFound()", () => {
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
    const files = walk(APP);
    const loadings = files.filter((f) => f.endsWith(`${path.sep}loading.tsx`)).map(path.dirname);
    const offenders = files
      .filter((f) => f.endsWith(`${path.sep}page.tsx`) && /notFound\(\)/.test(fs.readFileSync(f, "utf8")))
      .filter((f) => loadings.some((d) => path.dirname(f).startsWith(d + path.sep) || path.dirname(f) === d))
      .map((f) => path.relative(APP, f));
    expect(offenders).toEqual([]);
  });
  it("the lookups behind them are static (no slug is served that the list does not have)", () => {
    expect(getArticle("nonexistent")).toBeUndefined();
    expect(getNewsItem("nonexistent")).toBeUndefined();
    expect(getEvent("nonexistent")).toBeUndefined();
  });
});

describe("404 pages", () => {
  const APP = path.join(__dirname, "..", "..", "app");
  it("root and English 404s have their own single title and are noindex", () => {
    const root = fs.readFileSync(path.join(APP, "not-found.tsx"), "utf8");
    const en = fs.readFileSync(path.join(APP, "en", "not-found.tsx"), "utf8");
    expect(root).toMatch(/title: "الصفحة غير موجودة"/);
    expect(en).toMatch(/title: \{ absolute: "Page not found \| Sham AI" \}/);
    for (const s of [root, en]) expect(s).toMatch(/robots: \{ index: false/);
    expect(fs.readFileSync(path.join(APP, "en", "[...missing]", "page.tsx"), "utf8")).toMatch(/notFound\(\)/);
  });
});
