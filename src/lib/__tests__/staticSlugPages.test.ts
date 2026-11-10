// /news, /articles and /events have a loading.tsx, so a missing slug rendered «not found» with HTTP 200 (soft 404).
// Their slugs are all static lists, so unknown ones are refused before rendering (dynamicParams = false → real 404).
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
    expect(fs.existsSync(path.join(APP, seg, "loading.tsx"))).toBe(true);
  });
  it("the lookups behind them are static (no slug is served that the list does not have)", () => {
    expect(getArticle("nonexistent")).toBeUndefined();
    expect(getNewsItem("nonexistent")).toBeUndefined();
    expect(getEvent("nonexistent")).toBeUndefined();
  });
});
