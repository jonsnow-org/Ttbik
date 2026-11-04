import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("every registered free tool points to an existing page", () => {
  const source = readFileSync(path.join(root, "src/lib/freeTools.ts"), "utf8");
  const routes = [...source.matchAll(/href:\s*"([^"]+)"/g)].map((match) => match[1]);

  assert.ok(routes.length > 0, "free tools registry should not be empty");
  assert.equal(new Set(routes).size, routes.length, "free tool routes must be unique");

  for (const route of routes) {
    assert.ok(route.startsWith("/"), "tool route must be site-relative: " + route);
    const page = path.join(root, "src/app", route.replace(/^\/+|\/+$/g, ""), "page.tsx");
    assert.ok(existsSync(page), "registered route has no page: " + route);
  }
});

test("public Telegram bot cards stay direct and do not carry referral payloads", () => {
  const source = readFileSync(path.join(root, "src/lib/liveBots.ts"), "utf8");
  const links = [...source.matchAll(/href:\s*"([^"]+)"/g)].map((match) => match[1]);

  assert.ok(links.length > 0, "public bot registry should not be empty");
  assert.equal(new Set(links).size, links.length, "public bot links must be unique");

  for (const link of links) {
    const url = new URL(link);
    assert.equal(url.protocol, "https:");
    assert.equal(url.hostname, "t.me");
    assert.equal(url.search, "", "public bot link must not trigger a referral: " + link);
  }
});


test("every registered Arabic free tool has a page, page metadata, and tool SEO content", () => {
  const registry = readFileSync(path.join(root, "src/lib/freeTools.ts"), "utf8");
  const seo = readFileSync(path.join(root, "src/lib/toolSeo.ts"), "utf8");
  const routes = [...registry.matchAll(/href:\s*"([^"]+)"/g)]
    .map((match) => match[1])
    .filter((route) => route.startsWith("/free-tools/"));
  const seoSlugs = new Set([...seo.matchAll(/^\s*"([^"]+)":\s*\{/gm)].map((match) => match[1]));

  assert.ok(routes.length > 0, "Arabic free-tool registry should contain tool pages");
  for (const route of routes) {
    const slug = route.split("/").filter(Boolean).at(-1);
    const pagePath = path.join(root, "src/app", route.replace(/^\/+|\/+$/g, ""), "page.tsx");
    assert.ok(existsSync(pagePath), "registered Arabic tool page is missing: " + route);
    const pageSource = readFileSync(pagePath, "utf8");
    assert.match(pageSource, /export\s+const\s+metadata\b/, "Arabic tool page must define metadata: " + route);
    assert.ok(seoSlugs.has(slug), "Arabic tool is missing explanatory SEO content: " + slug);
  }
});

test("every registered English free tool has a page, metadata, SEO content, and sitemap coverage", () => {
  const registry = readFileSync(path.join(root, "src/lib/enFreeTools.ts"), "utf8");
  const seo = readFileSync(path.join(root, "src/lib/enToolSeo.ts"), "utf8");
  const sitemap = readFileSync(path.join(root, "src/app/sitemap.ts"), "utf8");
  const routes = [...registry.matchAll(/href:\s*"([^"]+)"/g)].map((match) => match[1]);
  const seoSlugs = new Set([...seo.matchAll(/slug:\s*"([^"]+)"/g)].map((match) => match[1]));

  assert.ok(routes.length > 0, "English free-tool registry should not be empty");
  assert.match(sitemap, /import\s+\{\s*EN_FREE_TOOLS\s*\}\s+from\s+["']@\/lib\/enFreeTools["']/, "sitemap must import the English registry");
  assert.match(sitemap, /EN_FREE_TOOLS\.filter\s*\(/, "sitemap must include registered English tools dynamically");

  for (const route of routes) {
    const slug = route.split("/").filter(Boolean).at(-1);
    const pagePath = path.join(root, "src/app", route.replace(/^\/+|\/+$/g, ""), "page.tsx");
    assert.ok(existsSync(pagePath), "registered English tool page is missing: " + route);
    const pageSource = readFileSync(pagePath, "utf8");
    assert.match(pageSource, /export\s+const\s+metadata\b/, "English tool page must define metadata: " + route);
    assert.ok(seoSlugs.has(slug), "English tool is missing long-form SEO and FAQ content: " + slug);
  }
});

test("visitor-specific tool result pages remain excluded from indexing", () => {
  const resultPages = [
    "src/app/free-tools/business-name-generator/result/page.tsx",
    "src/app/free-tools/text-analyzer/result/page.tsx",
    "src/app/free-tools/whatsapp-link/result/page.tsx",
    "src/app/free-tools/writing-assistant/result/page.tsx",
  ];

  for (const file of resultPages) {
    const source = readFileSync(path.join(root, file), "utf8");
    assert.match(source, /robots:\s*\{[^}]*index:\s*false/s, "result page must stay noindex: " + file);
  }
});
