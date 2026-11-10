// Owner could not find /remit, /contests, /khatma, /channels, /advertise, /shop from the site (2026-11-10).
// They now share one list used by the side menu, the footer and the home page; every one is a real page and in the sitemap.
import fs from "fs";
import path from "path";
import { SERVICE_LINKS, SIDEBAR_SERVICES_SECTION } from "@/config/navigation";

const APP = path.join(__dirname, "..", "..", "app");
const read = (rel: string) => fs.readFileSync(path.join(APP, rel), "utf8");

describe("service links are discoverable", () => {
  it("lists the six services the owner asked for", () => {
    const hrefs = SERVICE_LINKS.map((s) => s.href);
    for (const h of ["/remit", "/contests", "/khatma", "/channels", "/advertise", "/shop"]) expect(hrefs).toContain(h);
    expect(SIDEBAR_SERVICES_SECTION.links.map((l) => l.href)).toEqual(hrefs);
  });
  it("every link is a real page", () => {
    for (const s of SERVICE_LINKS) expect(fs.existsSync(path.join(APP, s.href.slice(1), "page.tsx"))).toBe(true);
  });
  it("menu, footer and home page use the list, and the home page has the #services anchor the menus point to", () => {
    expect(fs.readFileSync(path.join(__dirname, "..", "..", "components", "MobileNav.tsx"), "utf8")).toContain("SIDEBAR_SERVICES_SECTION");
    expect(read("layout.tsx")).toContain("SERVICE_LINKS");
    expect(read("layout.tsx")).not.toContain('href="/#categories"');
    const home = read("page.tsx");
    expect(home).toContain("SERVICE_LINKS");
    expect(home).toContain('id="services"');
  });
  it("every service is in the sitemap", () => {
    const map = read("sitemap.ts");
    for (const s of SERVICE_LINKS) expect(map).toContain("`${base}" + s.href + "`");
  });
});
