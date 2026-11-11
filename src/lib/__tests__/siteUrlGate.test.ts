// Vercel stopped (HTTP 402, 2026-11-11): every generated or stored promo link uses the live address (the gate), never ttbik.vercel.app.
import fs from "fs";
import path from "path";
import { GATE_URL, isLegacySiteUrl, publicBase, publicSiteUrl, rewriteLegacyLinks } from "@/lib/siteUrl";

const GATE = "https://ttbik-gate.jonsnowx1r.workers.dev";

describe("public site base", () => {
  const env = process.env.NEXT_PUBLIC_SITE_URL;
  afterEach(() => { process.env.NEXT_PUBLIC_SITE_URL = env; });
  it("falls back to the gate from deploy/hosting/site.json", () => {
    expect(GATE_URL).toBe(GATE);
    expect(publicBase("")).toBe(GATE);
    expect(publicBase(undefined)).toBe(GATE);
  });
  it("an env still set to the old Vercel address (or a preview alias) gives the gate", () => {
    for (const v of ["https://ttbik.vercel.app", "https://ttbik.vercel.app/", "ttbik.vercel.app", "https://ttbik-git-main-jon.vercel.app"]) expect(publicBase(v)).toBe(GATE);
    process.env.NEXT_PUBLIC_SITE_URL = "https://ttbik.vercel.app";
    expect(publicSiteUrl()).toBe(GATE);
  });
  it("keeps any other configured base (e.g. a future custom domain), without the trailing slash", () => {
    expect(publicBase("https://example.org/")).toBe("https://example.org");
    process.env.NEXT_PUBLIC_SITE_URL = "https://example.org";
    expect(publicSiteUrl()).toBe("https://example.org");
    expect(isLegacySiteUrl("https://someone-else.vercel.app")).toBe(false);
  });
});

describe("stored promo texts", () => {
  it("rewrites every old link, keeping path and query", () => {
    expect(rewriteLegacyLinks("جرّب: https://ttbik.vercel.app/free-tools/qr-generator?ref=5 و ttbik.vercel.app/c/x", GATE)).toBe(
      `جرّب: ${GATE}/free-tools/qr-generator?ref=5 و ${GATE}/c/x`,
    );
    expect(rewriteLegacyLinks("https://someone-else.vercel.app/a", GATE)).toBe("https://someone-else.vercel.app/a");
    expect(rewriteLegacyLinks("no links", GATE)).toBe("no links");
  });
});

describe("no promo/link code emits ttbik.vercel.app", () => {
  const root = path.join(__dirname, "..", "..", "..");
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) return e.name === "__tests__" || e.name === "node_modules" ? [] : walk(p);
    return /\.(ts|tsx|js|mjs|json|py)$/.test(e.name) ? [p] : [];
  });
  // Left on purpose: comments and the protected Athar activation route (owner rule), and the hosting failover code that
  // detects the old address in order to move it.
  const ALLOW = [/src\/app\/api\/admin\/bots\/activate-athar\//, /src\/lib\/hostingOps\.ts$/, /src\/lib\/siteUrl\.ts$/];
  it("src/, promo/ and media-bot/ have no hardcoded old address outside comments", () => {
    const bad: string[] = [];
    for (const dir of ["src", "promo", "media-bot", "scripts/hosting"]) {
      for (const f of walk(path.join(root, dir))) {
        const rel = path.relative(root, f);
        if (ALLOW.some((r) => r.test(rel)) || /package-lock|node_modules/.test(rel)) continue;
        fs.readFileSync(f, "utf8").split("\n").forEach((line, i) => {
          const code = line.replace(/\/\/.*$/, "").replace(/#.*$/, "");
          if (/ttbik\.vercel\.app/.test(code) && !/^\s*\*/.test(line)) bad.push(`${rel}:${i + 1}`);
        });
      }
    }
    expect(bad).toEqual([]);
  });
});
