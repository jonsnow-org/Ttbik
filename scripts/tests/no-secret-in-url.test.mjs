import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// CRON_SECRET travels in the Authorization header, never in a URL (URLs land in the access logs of Vercel, Cloudflare and Caddy).
const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
// interactive helpers kept on purpose (a browser flow / another secret): not cron endpoints
const ALLOWED = new Set(["src/app/api/bots/update-token/route.ts", "src/app/api/revalidate/route.ts", "src/app/api/youtube/oauth/route.ts"]);

test("no API route accepts the cron secret from the query string", () => {
  const bad = walk("src/app/api").filter((f) => f.endsWith("route.ts") && !ALLOWED.has(f)).filter((f) => /get\("secret"\)/.test(readFileSync(f, "utf8")));
  assert.deepEqual(bad, []);
});
test("no workflow or script sends the cron secret in a URL", () => {
  const files = [...walk(".github/workflows"), ...walk("scripts").filter((f) => /\.(mjs|sh)$/.test(f) && !f.startsWith("scripts/tests/"))];
  const bad = files.filter((f) => /[?&]secret=\$\{?CRON_SECRET|"secret=\$\{?CRON_SECRET|[?&]secret=\$\{encodeURIComponent/.test(readFileSync(f, "utf8")));
  assert.deepEqual(bad, []);
});
