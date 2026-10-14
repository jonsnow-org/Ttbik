/**
 * Match mini-app — full local QA pass (NOT part of CI).
 * Needs the local virtual env: `bash scripts/qa/env.sh up` (local Postgres +
 * fake Telegram API + next start on :3100). Never points at prod.
 * Run: cd e2e && npx playwright test
 */
import { test, expect, Page, Browser, BrowserContext, request as pwRequest } from "@playwright/test";
import { createHmac } from "crypto";
import { execSync } from "child_process";
import * as path from "path";

const BASE = process.env.QA_BASE_URL || "http://localhost:3100";
const MOCK = process.env.QA_TG_MOCK || "http://localhost:54400";
const BOT = "qa-bot";
const TOKEN = "123456:QA-FAKE-TOKEN"; // fake, seeded locally
const SECRET = "qa-secret";
const SHOTS = process.env.QA_SHOTS || "/workspace/qa/shots";
const ROOT = path.resolve(__dirname, "..");

type Issue = { user: string; kind: string; detail: string };
const issues: Issue[] = [];

function signInitData(user: { id: number; first_name: string }): string {
  const fields: Record<string, string> = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: "AAQA" + user.id,
    user: JSON.stringify({ ...user, language_code: "ar" }),
  };
  const pairs = Object.entries(fields).map(([k, v]) => `${k}=${v}`).sort();
  const secret = createHmac("sha256", "WebAppData").update(TOKEN).digest();
  const hash = createHmac("sha256", secret).update(pairs.join("\n")).digest("hex");
  const p = new URLSearchParams(fields); p.set("hash", hash);
  return p.toString();
}

export async function api(id: number, action: string, extra: Record<string, unknown> = {}) {
  const ctx = await pwRequest.newContext();
  const r = await ctx.post(`${BASE}/api/match-app/${BOT}`, { data: { initData: signInitData({ id, first_name: "u" + id }), action, ...extra } });
  const body = await r.json().catch(() => ({}));
  await ctx.dispose();
  return { status: r.status(), body: body as any };
}
async function webhook(update: Record<string, unknown>) {
  const ctx = await pwRequest.newContext();
  const r = await ctx.post(`${BASE}/api/telegram/${BOT}`, { data: { update_id: Math.floor(Math.random() * 1e9), ...update }, headers: { "x-telegram-bot-api-secret-token": SECRET } });
  await ctx.dispose();
  return r.status();
}
let msgId = 1;
const tgText = (uid: number, text: string) => webhook({ message: { message_id: msgId++, date: Math.floor(Date.now() / 1000), chat: { id: uid, type: "private" }, from: { id: uid, is_bot: false, first_name: "u" + uid }, text } });
async function tgCalls(): Promise<any[]> { const r = await fetch(`${MOCK}/__calls`); return r.json(); }
async function tgReset() { await fetch(`${MOCK}/__reset`); }
const sentTo = (calls: any[], chat: number) => calls.filter((c) => /send(Message|Photo)/.test(c.method) && String(c.payload?.chat_id) === String(chat));

function reseed() { execSync(`bash scripts/qa/env.sh seed`, { cwd: ROOT, stdio: "inherit" }); }

async function openApp(browser: Browser, id: number, name = "u" + id, opts: { onboarding?: boolean } = {}): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "ar" });
  const initData = signInitData({ id, first_name: name });
  await ctx.addInitScript(({ initData, id, name }) => {
    const handlers: Function[] = [];
    const mb: any = { text: "", isVisible: false, setParams(p: any) { Object.assign(mb, { text: p.text ?? mb.text, isVisible: p.is_visible ?? mb.isVisible }); },
      onClick(h: Function) { handlers.push(h); }, offClick(h: Function) { const i = handlers.indexOf(h); if (i >= 0) handlers.splice(i, 1); },
      show() { mb.isVisible = true; }, hide() { mb.isVisible = false; }, showProgress() {}, hideProgress() {}, enable() {}, disable() {} };
    (window as any).__tg = { invoices: [] as string[], links: [] as string[], closed: 0, mainClick: () => handlers.slice().forEach((h) => h()) };
    (window as any).Telegram = { WebApp: {
      initData, initDataUnsafe: { user: { id, first_name: name } }, version: "8.0", platform: "android", colorScheme: "dark",
      themeParams: { bg_color: "#0b0b12", text_color: "#ffffff" }, viewportHeight: 844, viewportStableHeight: 844, isExpanded: true,
      ready() {}, expand() {}, close() { (window as any).__tg.closed++; }, setHeaderColor() {}, setBackgroundColor() {}, enableClosingConfirmation() {}, disableVerticalSwipes() {},
      onEvent() {}, offEvent() {}, MainButton: mb, BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
      HapticFeedback: { impactOccurred() {}, notificationOccurred() {}, selectionChanged() {} },
      showConfirm(_t: string, cb: (ok: boolean) => void) { cb(true); }, showAlert(_t: string, cb?: () => void) { cb?.(); }, showPopup(_p: any, cb?: (id: string) => void) { cb?.("ok"); },
      openInvoice(link: string, cb?: (s: string) => void) { (window as any).__tg.invoices.push(link); cb?.("cancelled"); },
      openTelegramLink(u: string) { (window as any).__tg.links.push(u); }, openLink(u: string) { (window as any).__tg.links.push(u); },
      switchInlineQuery() {}, CloudStorage: { getItem(_k: string, cb: any) { cb(null, ""); }, setItem(_k: string, _v: string, cb?: any) { cb?.(null, true); } },
    } };
  }, { initData, id, name });
  if (!opts.onboarding) await ctx.addInitScript(() => { try { localStorage.setItem("match_onb_v1", "1"); } catch {} });
  await ctx.route(/telegram-web-app\.js/, (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "/* mocked */" }));
  const page = await ctx.newPage();
  const who = `${id}`;
  page.on("console", (m) => { if (m.type() === "error") issues.push({ user: who, kind: "console", detail: m.text().slice(0, 300) }); });
  page.on("pageerror", (e) => issues.push({ user: who, kind: "pageerror", detail: String(e).slice(0, 300) }));
  page.on("response", async (r) => {
    if (r.status() >= 400 && !r.url().includes("favicon")) {
      let b = ""; try { b = (await r.text()).slice(0, 200); } catch {}
      issues.push({ user: who, kind: `http ${r.status()}`, detail: `${r.request().method()} ${r.url().replace(BASE, "")} ${b}` });
    }
  });
  await page.goto(`/match-app/${BOT}`);
  await page.waitForLoadState("networkidle");
  return { ctx, page };
}

async function shot(page: Page, name: string) {
  const overflow = await page.evaluate(() => {
    const w = window.innerWidth; const bad: string[] = [];
    if (document.documentElement.scrollWidth > w + 1) bad.push(`doc scrollWidth ${document.documentElement.scrollWidth}>${w}`);
    document.querySelectorAll("body *").forEach((el) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width && (r.right > w + 2 || r.left < -2)) {
        let p: HTMLElement | null = el.parentElement; let clipped = false;
        while (p) { const s = getComputedStyle(p); if (/(auto|scroll|hidden)/.test(s.overflowX)) { clipped = true; break; } p = p.parentElement; }
        if (!clipped && getComputedStyle(el).position !== "fixed") bad.push(`${el.tagName}.${String((el as HTMLElement).className).slice(0, 40)} [${Math.round(r.left)},${Math.round(r.right)}]`);
      }
    });
    return bad.slice(0, 5);
  });
  if (overflow.length) issues.push({ user: name, kind: "overflow", detail: overflow.join(" | ") });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}
const nav = async (page: Page, label: string) => { try { await page.locator("nav button", { hasText: label }).click({ timeout: 15_000 }); } catch (e) { await page.screenshot({ path: `${SHOTS}/nav-fail-${label}.png` }); issues.push({ user: "nav", kind: "nav", detail: label + " " + (await page.locator("body").innerText()).slice(0, 300) }); throw e; } };
const toast = (page: Page, re: RegExp) => expect(page.getByText(re).first()).toBeVisible({ timeout: 15_000 });


test.beforeAll(() => { reseed(); });
test.afterAll(async () => {
  const fs = await import("fs");
  fs.writeFileSync(`${SHOTS}/../issues.json`, JSON.stringify(issues, null, 2));
  console.log(`QA issues captured: ${issues.length}`);
  for (const i of issues) console.log(` - [${i.user}] ${i.kind}: ${i.detail}`);
});

test("boot: every tab renders for a normal user; outside Telegram is handled", async ({ browser, page }) => {
  await page.goto(`/match-app/${BOT}`);
  await expect(page.getByText(/تلجرام|Telegram/).first()).toBeVisible();
  const { ctx, page: p } = await openApp(browser, 1001, "أحمد");
  for (const [label, name] of [["دردشة مجهولة", "anon"], ["المطابقات", "discover"], ["محادثاتي", "chats"], ["ملفي", "me"]] as const) {
    await nav(p, label); await p.waitForTimeout(800); await shot(p, `1001-${name}`);
  }
  await expect(p.locator("nav button", { hasText: "لوحة القيادة" })).toHaveCount(0);
  await ctx.close();
});

test("api: bad initData rejected, non-admin denied admin actions", async () => {
  const ctx = await pwRequest.newContext();
  const r = await ctx.post(`${BASE}/api/match-app/${BOT}`, { data: { initData: "user=%7B%22id%22%3A1%7D&hash=deadbeef", action: "me" } });
  expect(r.status()).toBe(401); await ctx.dispose();
  for (const a of ["admin_overview", "admin_broadcast", "admin_unban", "admin_lookup"]) {
    const x = await api(1001, a, { text: "x", userId: "1006" });
    expect(x.status, a).toBe(403);
  }
});

test("anon: AI interlocutor chat stays inside the app", async ({ browser }) => {
  await tgReset();
  const { ctx, page } = await openApp(browser, 1001, "أحمد");
  await nav(page, "دردشة مجهولة"); await page.waitForTimeout(1500);
  await page.evaluate(() => (window as any).__tg.mainClick()).then(() => undefined);
  await expect(page.getByPlaceholder("اكتب رسالتك (نص فقط)…")).toBeVisible({ timeout: 25_000 });
  await shot(page, "anon-ai-connected");
  const box = page.getByPlaceholder("اكتب رسالتك (نص فقط)…");
  await box.fill("مرحبا كيف الحال"); await box.press("Enter");
  await expect(page.getByText("مرحبا كيف الحال").first()).toBeVisible();
  await page.waitForTimeout(9000);
  await shot(page, "anon-ai-reply");
  const calls = await tgCalls();
  expect(sentTo(calls, 1001), "nothing should be pushed to the bot chat while the app is open").toHaveLength(0);
  await page.getByRole("button", { name: "إنهاء المحادثة" }).click({ force: true, timeout: 10_000 });
  await page.waitForTimeout(1500);
  await shot(page, "anon-ai-ended");
  await ctx.close();
});

test("anon: two app users match, chat, contact-guard, 15-msg contact exchange, report, block, end", async ({ browser }) => {
  reseed(); await tgReset();
  const a = await openApp(browser, 1001, "أحمد");
  const b = await openApp(browser, 1005, "ليلى");
  for (const x of [a, b]) { await nav(x.page, "دردشة مجهولة"); await x.page.waitForTimeout(1500); }
  await a.page.evaluate(() => (window as any).__tg.mainClick()).then(() => undefined);
  await a.page.waitForTimeout(700);
  await b.page.evaluate(() => (window as any).__tg.mainClick()).then(() => undefined);
  const inputA = a.page.getByPlaceholder("اكتب رسالتك (نص فقط)…");
  const inputB = b.page.getByPlaceholder("اكتب رسالتك (نص فقط)…");
  await expect(inputA).toBeVisible({ timeout: 30_000 });
  await expect(inputB).toBeVisible({ timeout: 30_000 });
  const pa = await api(1001, "anon_poll"); const pb = await api(1005, "anon_poll");
  expect(pa.body.fake, "two real app users searching together must be matched to each other").toBeFalsy();
  expect(pb.body.fake).toBeFalsy();
  await shot(a.page, "anon-real-a");
  // contact blocking
  await inputA.fill("رقمي 0551234567 كلمني واتساب"); await inputA.press("Enter");
  await a.page.waitForTimeout(2500);
  await shot(a.page, "anon-contact-blocked");
  const leaked = await b.page.getByText("0551234567").count();
  expect(leaked, "contact info must never reach the partner").toBe(0);
  // 15 messages total
  for (let i = 0; i < 8; i++) {
    await inputA.fill(`رسالة من أحمد ${i}`); await inputA.press("Enter");
    await inputB.fill(`رد من ليلى ${i}`); await inputB.press("Enter");
    await a.page.waitForTimeout(250);
  }
  await expect(b.page.getByText("رسالة من أحمد 7")).toBeVisible({ timeout: 15_000 });
  await expect(a.page.getByText("رد من ليلى 7")).toBeVisible({ timeout: 15_000 });
  await shot(b.page, "anon-real-b-16msgs");
  expect(sentTo(await tgCalls(), 1005).length, "app-active partner must not get bot pushes").toBe(0);
  // contact exchange
  const c1 = await api(1001, "anon_contact"); expect(c1.body.ok, JSON.stringify(c1.body)).toBeTruthy();
  const c2 = await api(1005, "anon_contact"); expect(c2.body.ok, JSON.stringify(c2.body)).toBeTruthy();
  await a.page.waitForTimeout(3000);
  await shot(a.page, "anon-contact-exchanged");
  // report then block via UI
  await b.page.getByRole("button", { name: "إبلاغ" }).click({ force: true, timeout: 10_000 }).catch(() => {});
  await b.page.waitForTimeout(1500); await shot(b.page, "anon-reported");
  const st = await api(1005, "anon_poll");
  if (st.body.state === "chatting") {
    await b.page.getByRole("button", { name: "حظر" }).click({ force: true, timeout: 10_000 });
    await b.page.waitForTimeout(2500); await shot(b.page, "anon-blocked");
  }
  // the other side must be informed
  await a.page.waitForTimeout(4000); await shot(a.page, "anon-partner-ended");
  expect((await api(1001, "anon_poll")).body.state).not.toBe("chatting");
  await a.ctx.close(); await b.ctx.close();
});

test("anon: end with a reason (exit reasons sheet)", async ({ browser }) => {
  reseed();
  const a = await openApp(browser, 1001, "أحمد");
  const b = await openApp(browser, 1005, "ليلى");
  await nav(a.page, "دردشة مجهولة"); await nav(b.page, "دردشة مجهولة"); await a.page.waitForTimeout(1500);
  await a.page.evaluate(() => (window as any).__tg.mainClick()).then(() => undefined); await a.page.waitForTimeout(500);
  await b.page.evaluate(() => (window as any).__tg.mainClick()).then(() => undefined);
  await expect(a.page.getByPlaceholder("اكتب رسالتك (نص فقط)…")).toBeVisible({ timeout: 30_000 });
  const p = await api(1001, "anon_poll");
  if (!p.body.fake) {
    await a.page.getByRole("button", { name: "إنهاء المحادثة" }).click({ force: true, timeout: 10_000 });
    await shot(a.page, "anon-exit-reasons");
    await a.page.locator(".fixed button, button").filter({ hasText: /ممل|غير مهذب|أخرى|سبب|لا يوجد/ }).first().click({ force: true, timeout: 10_000 });
    await a.page.waitForTimeout(2000);
    expect((await api(1005, "anon_poll")).body.state).not.toBe("chatting");
  }
  await a.ctx.close(); await b.ctx.close();
});

test("anon: app user ↔ bot user via simulated webhook", async ({ browser }) => {
  reseed(); await tgReset();
  expect(await tgText(1006, "/start")).toBe(200);
  expect(await tgText(1006, "🔀 مراسلة عشوائية")).toBe(200);
  const a = await openApp(browser, 1001, "أحمد");
  await nav(a.page, "دردشة مجهولة");
  await a.page.waitForTimeout(1500);
  await a.page.evaluate(() => (window as any).__tg.mainClick()).then(() => undefined);
  const input = a.page.getByPlaceholder("اكتب رسالتك (نص فقط)…");
  await expect(input).toBeVisible({ timeout: 30_000 });
  const p = await api(1001, "anon_poll");
  test.info().annotations.push({ type: "pair", description: JSON.stringify(p.body).slice(0, 200) });
  if (!p.body.fake) {
    await input.fill("أهلاً من التطبيق"); await input.press("Enter");
    await a.page.waitForTimeout(2500);
    const toBot = sentTo(await tgCalls(), 1006).map((c) => c.payload.text || "");
    expect(toBot.join("\n")).toContain("أهلاً من التطبيق");
    expect(await tgText(1006, "أهلاً من البوت")).toBe(200);
    await expect(a.page.getByText("أهلاً من البوت")).toBeVisible({ timeout: 15_000 });
    await shot(a.page, "anon-app-bot");
    expect(await tgText(1006, "/end")).toBe(200);
  } else {
    issues.push({ user: "1001", kind: "logic", detail: "waiting bot user was not matched with app user" });
  }
  await a.ctx.close();
});

test("discover: swipes, like, super like, proposal, mutual match modal, compliment", async ({ browser }) => {
  reseed();
  const { ctx, page } = await openApp(browser, 1001, "أحمد");
  await nav(page, "المطابقات");
  await page.waitForTimeout(1500); await shot(page, "discover-deck");
  for (let i = 0; i < 4; i++) {
    const label = ["إعجاب", "تخطي", "مميز $1", "طلب زواج"][i];
    const btn = page.getByRole("button", { name: label });
    if (!(await btn.count())) break;
    await btn.click({ force: true, timeout: 10_000 }); await page.waitForTimeout(1500);
    await shot(page, `discover-after-${i}`);
    const modal = page.getByText("ابدأ دردشة مجهولة");
    if (await modal.count()) { await shot(page, "discover-match-modal"); await page.getByText("متابعة التصفح").click({ force: true, timeout: 10_000 }); }
  }
  // compliment via API (deck may be empty now)
  const comp = await api(1001, "deck"); test.info().annotations.push({ type: "deck", description: String(comp.body.items?.length) });
  await page.evaluate(() => (window as any).__tg.mainClick()).then(() => undefined);
  await page.waitForTimeout(1000); await shot(page, "discover-refresh");
  await ctx.close();
});

test("chats tab + compliments", async ({ browser }) => {
  reseed();
  const { ctx, page } = await openApp(browser, 1001, "أحمد");
  await nav(page, "محادثاتي"); await page.waitForTimeout(1500); await shot(page, "chats");
  const rose = page.getByRole("button", { name: "🌹" }).first();
  if (await rose.count()) {
    await rose.click({ force: true, timeout: 10_000 }); await page.waitForTimeout(800); await shot(page, "compliment-sheet");
    const opts = page.locator(".fixed button").first(); await opts.click({ force: true, timeout: 10_000 }); await page.waitForTimeout(1500);
    await shot(page, "compliment-sent");
  } else issues.push({ user: "1001", kind: "ux", detail: "chats tab has no match card for mutual 1001↔1005" });
  await ctx.close();
});

test("profile: edit, criteria, privacy, upgrades, insufficient balance, Stars invoice", async ({ browser }) => {
  reseed();
  const { ctx, page } = await openApp(browser, 1001, "أحمد");
  await nav(page, "ملفي"); await page.waitForTimeout(1200);
  for (const [k, n] of [["👤 ملفي", "me-profile"], ["💍 معايير الزواج", "me-pref"], ["🔒 الخصوصية", "me-privacy"], ["⭐ الترقيات", "me-upgrades"]] as const) {
    await page.getByRole("button", { name: k, exact: true }).first().click({ force: true, timeout: 10_000 }); await page.waitForTimeout(700); await shot(page, n);
    if (k === "👤 ملفي") {
      const bio = page.locator("textarea").first();
      if (await bio.count()) { await bio.fill("نبذة اختبار QA"); await page.evaluate(() => (window as any).__tg.mainClick()).then(() => undefined); await toast(page, /حُفظ|تم|✅/); }
    }
    if (k === "💍 معايير الزواج") { await page.evaluate(() => (window as any).__tg.mainClick()).then(() => undefined); await page.waitForTimeout(1500); await shot(page, "me-pref-saved"); }
    if (k === "🔒 الخصوصية") { const t = page.locator("button").filter({ hasText: /إخفاء|ظهور|مخفي/ }).first(); if (await t.count()) { await t.click({ force: true, timeout: 10_000 }); await page.waitForTimeout(1500); await shot(page, "me-privacy-toggled"); } }
  }
  // each upgrade via API (UI confirm already exercised by one click)
  const me = await api(1001, "me");
  const cat: any[] = me.body.catalog || me.body.upgrades || [];
  test.info().annotations.push({ type: "catalog", description: cat.map((c) => c.key).join(",") });
  for (const c of cat) {
    const r = await api(1001, "upgrade", { key: c.key });
    if (r.status >= 500) issues.push({ user: "1001", kind: "http 5xx", detail: `upgrade ${c.key}: ${JSON.stringify(r.body)}` });
  }
  const stars = page.locator("button").filter({ hasText: /⭐/ }).filter({ hasText: /\d/ }).last();
  const r = await api(1001, "deposit_stars", { stars: 100 });
  expect(r.body.ok, JSON.stringify(r.body)).toBeTruthy();
  await page.getByRole("button", { name: "⭐ الترقيات" }).click({ force: true, timeout: 10_000 });
  const starBtns = page.locator("button").filter({ hasText: /نجمة|Stars|⭐\s*\d|\d+\s*⭐/ });
  if (await starBtns.count()) { await starBtns.last().click({ force: true, timeout: 10_000 }); await page.waitForTimeout(1500); expect(await page.evaluate(() => (window as any).__tg.invoices.length)).toBeGreaterThan(0); }
  void stars;
  await shot(page, "me-after-purchases");
  await ctx.close();
  // insufficient balance (سارة $0.5)
  const s = await openApp(browser, 1005, "ليلى");
  await nav(s.page, "ملفي"); await s.page.waitForTimeout(1000);
  const boost = await api(1005, "upgrade", { key: "boost" });
  expect(boost.body.ok).toBeFalsy(); expect(String(boost.body.error)).toMatch(/لا يكفي|رصيد/);
  await shot(s.page, "me-insufficient");
  await s.ctx.close();
});

test("admin dashboard: every section and action", async ({ browser }) => {
  reseed(); await tgReset();
  const { ctx, page } = await openApp(browser, 9000, "Admin");
  await nav(page, "لوحة القيادة"); await page.waitForTimeout(1500); await shot(page, "admin-stats");
  const secs = ["نظرة عامة", "الملفات", "التوثيق", "بلاغات المطابقة", "بلاغات العشوائية", "الوارد", "مستخدم / رفع حظر", "بث", "السجل"];
  for (const [i, l] of secs.entries()) { await page.getByRole("button", { name: new RegExp(l) }).first().click({ force: true, timeout: 10_000 }); await page.waitForTimeout(1200); await shot(page, `admin-sec-${i}`); }
  for (const [a, extra] of [
    ["admin_overview", {}], ["admin_diagnostics", {}],
    ["admin_profile_decide", { userId: "1004", approve: true }],
    ["admin_verify_decide", { userId: "1003", approve: true }],
    ["admin_lookup", { userId: "1006" }],
    ["admin_unban", { userId: "1006" }],
    ["admin_broadcast", { text: "بث اختبار QA" }],
  ] as const) {
    const r = await api(9000, a, extra as any);
    expect(r.status, `${a} ${JSON.stringify(r.body)}`).toBeLessThan(500);
    if (!r.body.ok) issues.push({ user: "9000", kind: "admin", detail: `${a} → ${JSON.stringify(r.body).slice(0, 200)}` });
  }
  const rep = ((await api(9000, "admin_reports", { source: "SEARCH" })).body.items || [])[0]; if (rep) expect((await api(9000, "admin_report_resolve", { reportId: rep.id, act: "mute" })).body.ok).toBeTruthy();
  const msg = ((await api(9000, "admin_inbox")).body.items || [])[0];
  if (msg) {
    expect((await api(9000, "admin_inbox_reply", { messageId: msg.id, text: "رد QA" })).body.ok).toBeTruthy();
    expect((await api(9000, "admin_inbox_action", { messageId: msg.id, kind: "read" })).body.ok).toBeTruthy();
  }
  await page.reload(); await page.waitForLoadState("networkidle"); await nav(page, "لوحة القيادة"); await page.waitForTimeout(1200);
  await shot(page, "admin-after-actions");
  await ctx.close();
});

test("inline query endpoint answers", async () => {
  await tgReset();
  const st = await webhook({ inline_query: { id: "iq1", from: { id: 1001, is_bot: false, first_name: "a" }, query: "", offset: "" } });
  expect(st).toBe(200);
  await new Promise((r) => setTimeout(r, 2000));
  const calls = await tgCalls();
  expect(calls.some((c) => /answerInlineQuery/.test(c.method)), JSON.stringify(calls.map((c) => c.method))).toBeTruthy();
});

test("onboarding: shown once on first run, 3 steps", async ({ browser }) => {
  reseed();
  const { ctx, page } = await openApp(browser, 1001, "أحمد", { onboarding: true });
  await expect(page.getByText("أهلاً بك في توافق")).toBeVisible();
  await shot(page, "onboarding-1");
  await page.getByRole("button", { name: "التالي" }).click({ force: true });
  await page.getByRole("button", { name: "التالي" }).click({ force: true });
  await shot(page, "onboarding-3");
  await page.getByRole("button", { name: "ابدأ الآن" }).click({ force: true });
  await expect(page.getByText("أهلاً بك في توافق")).toHaveCount(0);
  await page.reload(); await page.waitForLoadState("networkidle");
  await expect(page.getByText("أهلاً بك في توافق")).toHaveCount(0);
  await ctx.close();
});

test("monetization: first-purchase discount, buy-now with Stars (idempotent), rewind, who liked me, funnel", async ({ browser }) => {
  reseed(); await tgReset();
  // first discount: 1001 has $20 and never bought → boost costs $1.6 once
  const me0 = await api(1001, "me"); expect(me0.body.firstDiscount).toBe(0.2);
  const b1 = await api(1001, "upgrade", { key: "boost" }); expect(b1.body.ok, JSON.stringify(b1.body)).toBeTruthy();
  const me1 = await api(1001, "me"); expect(me1.body.ent.balance).toBeCloseTo(18.4, 2); expect(me1.body.firstDiscount).toBe(0);
  // buy-now with Stars: 1005 has $0.3 → filters $2 (first discount → $1.6) → shortfall $1.3 = 130⭐
  const inv = await api(1005, "buy_stars", { key: "anonFilters" });
  expect(inv.body.ok, JSON.stringify(inv.body)).toBeTruthy(); expect(inv.body.stars).toBe(130);
  const pay = { message: { message_id: msgId++, date: Math.floor(Date.now() / 1000), chat: { id: 1005, type: "private" }, from: { id: 1005, is_bot: false, first_name: "ليلى" },
    successful_payment: { currency: "XTR", total_amount: 130, invoice_payload: "MATCH_BUY_anonFilters:1005", telegram_payment_charge_id: "qa-charge-1", provider_payment_charge_id: "p" } } };
  expect(await webhook(pay)).toBe(200);
  expect(await webhook(pay)).toBe(200); // redelivery → nothing twice
  const me5 = await api(1005, "me");
  expect(me5.body.anonFilters.owned, JSON.stringify(me5.body.anonFilters)).toBeTruthy();
  expect(me5.body.ent.balance).toBeCloseTo(0, 2);
  // UI: insufficient → buy-now button visible
  const s = await openApp(browser, 1002, "سارة");
  await nav(s.page, "ملفي"); await s.page.waitForTimeout(1200);
  await shot(s.page, "upgrades-buy-now");
  await s.ctx.close();
  // rewind: skip then rewind (1001 has balance)
  const deck = await api(1001, "discover");
  const first = deck.body.items?.[0];
  if (first) {
    await api(1001, "swipe", { target: first.ref, kind: "pass" });
    const rw = await api(1001, "rewind"); expect(rw.body.ok, JSON.stringify(rw.body)).toBeTruthy(); expect(rw.body.item.ref).toBe(first.ref);
    const none = await api(1001, "rewind"); expect(none.body.ok).toBeFalsy();
  }
  // who liked me (free, like the bot): 1002 liked 1001
  const lm = await api(1001, "liked_me"); expect(lm.body.items.length).toBeGreaterThan(0);
  const a = await openApp(browser, 1001, "أحمد");
  await nav(a.page, "محادثاتي"); await a.page.waitForTimeout(1500); await shot(a.page, "chats-liked-me");
  await nav(a.page, "المطابقات"); await a.page.waitForTimeout(1200);
  await a.page.getByRole("button", { name: "تخطي" }).click({ force: true }).catch(() => {}); await a.page.waitForTimeout(800);
  await shot(a.page, "discover-rewind-button");
  await a.ctx.close();
  // funnel visible to admin
  const f = await api(9000, "admin_funnel"); expect(f.body.ok).toBeTruthy();
  const by = Object.fromEntries(f.body.items.map((r: any) => [r.event, r.users]));
  expect(by.purchase_success).toBeGreaterThan(0); expect(by.stars_paid).toBeGreaterThan(0);
  const ad = await openApp(browser, 9000, "Admin");
  await nav(ad.page, "لوحة القيادة"); await ad.page.waitForTimeout(800);
  await ad.page.getByRole("button", { name: /التحويل/ }).first().click({ force: true }); await ad.page.waitForTimeout(1200);
  await shot(ad.page, "admin-funnel");
  await ad.ctx.close();
});

test("anon: read receipts and typing indicator between two app users", async ({ browser }) => {
  reseed();
  const a = await openApp(browser, 1001, "أحمد"); const b = await openApp(browser, 1005, "ليلى");
  for (const x of [a, b]) { await nav(x.page, "دردشة مجهولة"); await x.page.waitForTimeout(1500); }
  await a.page.evaluate(() => (window as any).__tg.mainClick()); await a.page.waitForTimeout(800);
  await b.page.evaluate(() => (window as any).__tg.mainClick());
  const ia = a.page.getByPlaceholder("اكتب رسالتك (نص فقط)…"); const ib = b.page.getByPlaceholder("اكتب رسالتك (نص فقط)…");
  await expect(ia).toBeVisible({ timeout: 30_000 }); await expect(ib).toBeVisible({ timeout: 30_000 });
  await ia.fill("مرحبا"); await ia.press("Enter");
  await expect(b.page.getByText("مرحبا")).toBeVisible({ timeout: 15_000 });
  await expect(a.page.getByText("✓✓").first()).toBeVisible({ timeout: 20_000 });
  await ib.pressSequentially("أكتب الآن", { delay: 60 });
  await expect(a.page.getByText("يكتب الآن…")).toBeVisible({ timeout: 15_000 });
  await shot(a.page, "anon-typing-read");
  await api(1001, "anon_end", { reason: "other" });
  await a.ctx.close(); await b.ctx.close();
});
