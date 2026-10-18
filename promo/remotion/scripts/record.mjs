// Mobile-viewport screen recording of the live site (free, Playwright). Usage: node record.mjs <site> <path> <input> <outDir>
import { chromium, devices } from "playwright";
import fs from "node:fs";
const [site, path, input, out, lang = "ar", home = "1", rec = "0", interact = "1"] = process.argv.slice(2);
const browser = await chromium.launch();
const ctx = await browser.newContext({
  ...devices["Pixel 7"],
  viewport: { width: 412, height: 732 },
  recordVideo: { dir: out, size: { width: 412, height: 732 } },
  locale: lang === "en" ? "en-US" : "ar",
});
const page = await ctx.newPage();
const wait = (ms) => page.waitForTimeout(ms);
const smooth = async (dy, steps = 30) => { for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, dy / steps); await wait(40); } };
if (home !== "0") {   // the Sham AI tool videos start from the site's home page; project videos (Athar, Zenobia, Palmyra Launch) go straight to their own page
  await page.goto(site + "/", { waitUntil: "domcontentloaded" });
  await wait(2500);
  await smooth(900); await wait(600); await smooth(-900, 15);
}
// rec=1 hides the platform's tab bar and language button, so no foreign-language label shows in the video; lang pins the page language
const q = (rec === "1" ? (path.includes("?") ? "&" : "?") + "rec=1&lang=" + (lang === "en" ? "en" : "ar") : "");
await page.goto(site + path + q, { waitUntil: "domcontentloaded" });
await wait(rec === "1" ? 7000 : 2500);   // project pages read the chain and the coin index: give them time to fill in
await smooth(250, 15);
const field = page.locator("input:visible:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea:visible").first();
try {
  if (interact === "0") { /* project videos only scroll: the first button on those pages is "Connect Wallet" */ }
  else if (input && (await field.count())) {
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
