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
