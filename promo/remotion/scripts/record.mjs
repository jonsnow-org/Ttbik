// Mobile-viewport screen recording of the live site (free, Playwright). Usage: node record.mjs <site> <path> <input> <outDir>
import { chromium, devices } from "playwright";
import fs from "node:fs";
const [site, path, input, out] = process.argv.slice(2);
const browser = await chromium.launch();
const ctx = await browser.newContext({
  ...devices["Pixel 7"],
  viewport: { width: 412, height: 732 },
  recordVideo: { dir: out, size: { width: 412, height: 732 } },
  locale: "ar",
});
const page = await ctx.newPage();
const wait = (ms) => page.waitForTimeout(ms);
const smooth = async (dy, steps = 30) => { for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, dy / steps); await wait(40); } };
await page.goto(site + "/", { waitUntil: "domcontentloaded" });
await wait(2500);
await smooth(900); await wait(600); await smooth(-900, 15);
await page.goto(site + path, { waitUntil: "domcontentloaded" });
await wait(2500);
await smooth(250, 15);
const field = page.locator("input:visible:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea:visible").first();
try {
  if (input && (await field.count())) {
    await field.scrollIntoViewIfNeeded(); await field.click(); await field.fill("");
    await field.pressSequentially(input, { delay: 120 });
    await wait(500);
    const btn = page.locator("main button:visible").first();
    if (await btn.count()) await btn.click({ timeout: 3000 }).catch(() => {});
  } else {
    const btn = page.locator("main button:visible").first();
    if (await btn.count()) await btn.click({ timeout: 3000 }).catch(() => {});
  }
} catch (e) { console.log("interaction skipped:", e.message); }
await wait(1500);
await smooth(500); await wait(1200); await smooth(400); await wait(1000);
const v = page.video();
await ctx.close(); await browser.close();
fs.renameSync(await v.path(), `${out}/screen.webm`);
console.log("recorded");
