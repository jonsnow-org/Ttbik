// Read-only page check for supervisors: opens URLs in headless Chromium at phone width and reports HTTP status, console errors, failed requests that
// matter, horizontal overflow, and visible text markers. Works in the sandbox (egress proxy) and on a normal machine.
//   node scripts/agent/render-check.mjs https://ttbik.vercel.app/ https://ttbik.vercel.app/prices --expect "Gold" --screenshot out
// Options: --expect <text> (repeatable; must appear in the visible text), --forbid <text> (repeatable), --width 390, --screenshot <dir>, --json
// Needs playwright-core (in node_modules or the global npx cache) and a Chromium: PLAYWRIGHT_BROWSERS_PATH / CHROMIUM_PATH or /opt/pw-browsers.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const urls = [], expect = [], forbid = [];
let width = 390, shotDir = "", asJson = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--expect") expect.push(args[++i]);
  else if (a === "--forbid") forbid.push(args[++i]);
  else if (a === "--width") width = Number(args[++i]) || 390;
  else if (a === "--screenshot") shotDir = args[++i];
  else if (a === "--json") asJson = true;
  else urls.push(a);
}
if (!urls.length) { console.error("usage: render-check.mjs <url>... [--expect text] [--forbid text] [--width 390] [--screenshot dir] [--json]"); process.exit(2); }

const require = createRequire(import.meta.url);
function loadPlaywright() {
  const tries = ["playwright-core", "playwright", ...fs.readdirSync("/root/.npm/_npx", { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => `/root/.npm/_npx/${d.name}/node_modules/playwright-core`)].filter(Boolean);
  for (const t of tries) { try { return require(t); } catch { /* next */ } }
  throw new Error("playwright-core not found: run `npm i --no-save playwright-core` in a scratch directory");
}
function chromiumPath() {
  const c = [process.env.CHROMIUM_PATH, ...(fs.existsSync("/opt/pw-browsers") ? fs.readdirSync("/opt/pw-browsers").filter((d) => d.startsWith("chromium")).map((d) => `/opt/pw-browsers/${d}/chrome-linux/chrome`) : [])].filter(Boolean);
  return c.find((p) => fs.existsSync(p));
}
// The sandbox's egress proxy re-signs TLS with its own CA. Trust exactly that CA (by its public-key hash), never "ignore all errors".
function proxyTrust() {
  const ca = "/root/.ccr/agent-proxy-ca.crt";
  if (!process.env.HTTPS_PROXY || !fs.existsSync(ca)) return { args: [], proxy: undefined };
  const pub = execFileSync("openssl", ["x509", "-in", ca, "-pubkey", "-noout"]);
  const der = execFileSync("openssl", ["pkey", "-pubin", "-outform", "DER"], { input: pub });
  const hash = execFileSync("openssl", ["dgst", "-sha256", "-binary"], { input: der }).toString("base64");
  return { args: [`--ignore-certificate-errors-spki-list=${hash}`], proxy: { server: process.env.HTTPS_PROXY } };
}

const { chromium } = loadPlaywright();
const trust = proxyTrust();
const browser = await chromium.launch({ executablePath: chromiumPath(), args: ["--no-sandbox", ...trust.args], proxy: trust.proxy });
const ctx = await browser.newContext({ viewport: { width, height: 844 }, locale: "en-US" });
const results = [];
for (const url of urls) {
  const page = await ctx.newPage();
  const errors = [], failed = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
  page.on("requestfailed", (r) => { const u = r.url(); if (!/doubleclick|google-analytics|googletagmanager|adsterra|\/ccm\/collect/.test(u)) failed.push(`${r.failure()?.errorText} ${u.slice(0, 100)}`); });
  let status = 0;
  try {
    const resp = await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
    status = resp?.status() ?? 0;
  } catch (e) { errors.push("navigation: " + String(e).slice(0, 160)); }
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => ({ text: document.body?.innerText || "", overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, title: document.title })).catch(() => ({ text: "", overflow: 0, title: "" }));
  const problems = [];
  if (status !== 200) problems.push(`HTTP ${status}`);
  if (info.overflow > 2) problems.push(`horizontal overflow ${info.overflow}px`);
  for (const t of expect) if (!info.text.includes(t)) problems.push(`missing text: ${t}`);
  for (const t of forbid) if (info.text.includes(t)) problems.push(`forbidden text present: ${t}`);
  if (errors.length) problems.push(`${errors.length} console error(s)`);
  if (shotDir) { fs.mkdirSync(shotDir, { recursive: true }); await page.screenshot({ path: path.join(shotDir, url.replace(/[^a-z0-9]+/gi, "_").slice(0, 80) + ".png"), fullPage: false }); }
  results.push({ url, status, title: info.title, textLength: info.text.length, problems, errors: errors.slice(0, 5), failedRequests: failed.slice(0, 5) });
  await page.close();
}
await browser.close();
if (asJson) console.log(JSON.stringify(results, null, 1));
else for (const r of results) console.log(`${r.problems.length ? "✗" : "✓"} ${r.url}  [${r.status}] "${r.title}" text=${r.textLength}${r.problems.length ? "\n    " + r.problems.join("\n    ") : ""}${r.errors.length ? "\n    errors: " + r.errors.join(" | ") : ""}`);
process.exit(results.some((r) => r.problems.length) ? 1 : 0);
