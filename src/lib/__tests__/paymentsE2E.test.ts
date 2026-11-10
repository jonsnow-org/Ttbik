// End-to-end payment paths with mocked providers (2026-11-10): a real HMAC-signed NOWPayments IPN goes through the
// actual route handlers against an in-memory ledger that enforces the unique txHash, like Postgres does.
import crypto from "crypto";
import { Prisma } from "@prisma/client";

jest.mock("next/server", () => ({
  NextRequest: class {},
  NextResponse: { json: (body: any, init?: any) => ({ body, status: init?.status || 200 }) },
}));

const state: any = { tx: [] as any[], users: new Map<string, number>(), ads: new Map<string, any>(), notified: [] as string[], revenue: 0 };
const dup = () => new Prisma.PrismaClientKnownRequestError("Unique constraint", { code: "P2002", clientVersion: "test" });
const db: any = {
  transaction: { create: jest.fn(async ({ data }: any) => { if (state.tx.some((t: any) => t.txHash === data.txHash)) throw dup(); state.tx.push(data); return data; }) },
  user: { upsert: jest.fn(async ({ where, update, create }: any) => { const b = state.users.get(where.id); state.users.set(where.id, b === undefined ? create.balance : b + update.balance.increment); }) },
  siteBannerAd: {
    findUnique: jest.fn(async ({ where }: any) => state.ads.get(where.reservationCode) ?? null),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const ad = state.ads.get(where.reservationCode);
      if (!ad) return { count: 0 };
      if (where.paymentStatus?.not && ad.paymentStatus === where.paymentStatus.not) return { count: 0 };
      if (where.credited === false && ad.credited) return { count: 0 };
      Object.assign(ad, data);
      if (data.credited === true) state.revenue += ad.totalPrice; // the one-time revenue claim (creditBanner)
      return { count: 1 };
    }),
  },
  // The site bot is not a builder bot: site-ad payments must never read or write the builder's Bot table.
  bot: { findMany: jest.fn(async () => { throw new Error("site ads touched the Bot table"); }), findUnique: jest.fn(async () => { throw new Error("site ads touched the Bot table"); }), update: jest.fn(async () => { throw new Error("site ads touched the Bot table"); }) },
  // all-or-nothing like Postgres: snapshot, run, restore on throw
  $transaction: jest.fn(async (fn: any) => {
    const snap = { tx: [...state.tx], users: new Map(state.users) };
    try { return await fn(db); } catch (e) { state.tx = snap.tx; state.users = snap.users; throw e; }
  }),
};
jest.mock("@/lib/prisma", () => ({ prisma: db }));
// Telegram is mocked at the network edge: admin notices, invoice links, pre-checkout answers and payer replies are captured.
const tg: { method: string; body: any }[] = [];
(global as any).fetch = jest.fn(async (url: string, init?: any) => {
  const method = String(url).split("/").pop()!;
  const body = init?.body ? JSON.parse(init.body) : {};
  tg.push({ method, body });
  if (method === "sendMessage" && body.reply_markup?.inline_keyboard) state.notified.push(body.text);
  if (method === "createInvoiceLink") return { ok: true, json: async () => ({ ok: true, result: "https://t.me/$inv123" }) };
  return { ok: true, json: async () => ({ ok: true, result: { username: "admen10bot" } }) };
});

const SECRET = "ipn-test-secret";
function sorted(v: any): any {
  if (Array.isArray(v)) return v.map(sorted);
  if (v && typeof v === "object") return Object.keys(v).sort().reduce((o: any, k) => ((o[k] = sorted(v[k])), o), {});
  return v;
}
const sign = (body: any) => crypto.createHmac("sha512", SECRET).update(JSON.stringify(sorted(body))).digest("hex");
const req = (body: any, sig = sign(body)) => {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return { text: async () => raw, json: async () => JSON.parse(raw), headers: { get: (h: string) => (h === "x-nowpayments-sig" ? sig : null) } } as any;
};

import { POST as walletIpn } from "@/app/api/payments/webhook/route";
import { POST as adsIpn } from "@/app/api/ads/ipn/route";
import { POST as adsPay } from "@/app/api/ads/pay/route";
import { POST as siteBotHook } from "@/app/api/ads/telegram/route";
import { parseStarsPayload, starsForUsd, starsPayload, usdForStars } from "@/lib/starsPayment";
import { isRealDeposit, summarize } from "@/lib/revenue";

beforeEach(() => {
  process.env.NOWPAYMENTS_IPN_SECRET = SECRET;
  process.env.TELEGRAM_ADMIN_CHAT_ID = "777";
  process.env.TELEGRAM_WEBHOOK_SECRET = "hook-secret";
  process.env.CRON_SECRET = "cron-test";
  process.env.SITE_BOT_TOKEN = "t"; // the site bot's own config, not the Bot table
  tg.length = 0;
  state.tx = []; state.users = new Map(); state.ads = new Map(); state.notified = []; state.revenue = 0;
});

describe("NOWPayments → wallet balance (/api/payments/webhook)", () => {
  const ipn = { payment_id: 5551, order_id: "u1", payment_status: "finished", price_amount: 10, price_currency: "usd" };
  it("credits once; a redelivered IPN credits nothing", async () => {
    expect((await walletIpn(req(ipn))).status).toBe(200);
    expect((await walletIpn(req(ipn))).status).toBe(200);
    expect(state.users.get("u1")).toBe(10);
    expect(state.tx).toHaveLength(1);
    expect(isRealDeposit({ ...state.tx[0] })).toBe(true);
  });
  it("rejects a forged signature and ignores pending payments", async () => {
    expect((await walletIpn(req(ipn, "00"))).status).toBe(401);
    expect((await walletIpn(req({ ...ipn, payment_status: "waiting" }))).status).toBe(200);
    expect(state.users.size).toBe(0);
  });
  it("accepts 'confirmed' as paid", async () => {
    await walletIpn(req({ ...ipn, payment_id: 5552, payment_status: "confirmed" }));
    expect(state.users.get("u1")).toBe(10);
  });
});

describe("NOWPayments → site banner (/api/ads/ipn)", () => {
  const ipn = { payment_id: 9001, order_id: "adv-abc", payment_status: "finished", price_amount: 15 };
  beforeEach(() => state.ads.set("ADV-ABC", { reservationCode: "ADV-ABC", totalPrice: 15, durationDays: 7, targetUrl: "https://x.example", paymentStatus: "PENDING", adStatus: "PENDING_PAYMENT", credited: false }));
  it("marks paid, credits revenue and notifies the admin exactly once", async () => {
    expect((await adsIpn(req(ipn))).body).toMatchObject({ ok: true, duplicate: false });
    state.ads.get("ADV-ABC").adStatus = "ACTIVE"; // admin approved in between
    expect((await adsIpn(req(ipn))).body).toMatchObject({ ok: true, duplicate: true });
    expect(state.ads.get("ADV-ABC")).toMatchObject({ paymentStatus: "PAID", adStatus: "ACTIVE", credited: true });
    expect(state.revenue).toBe(15);
    expect(state.notified).toHaveLength(1);
  });
  it("bad JSON → 400, forged → 401, unknown code / underpaid → acknowledged without changes", async () => {
    expect((await adsIpn(req("{not json"))).status).toBe(400);
    expect((await adsIpn(req(ipn, "bad"))).status).toBe(401);
    expect((await adsIpn(req({ ...ipn, order_id: "ADV-NOPE" }))).body).toMatchObject({ ignored: "unknown order" });
    expect((await adsIpn(req({ ...ipn, price_amount: 5 }))).body).toMatchObject({ ignored: "underpaid" });
    expect(state.ads.get("ADV-ABC").paymentStatus).toBe("PENDING");
    expect(state.revenue).toBe(0);
  });
});

describe("Telegram Stars payloads", () => {
  it("round-trips buy-now payloads and converts at 100 Stars = $1", () => {
    expect(parseStarsPayload(starsPayload("MATCH_BUY_anonFilters", "42"))).toEqual({ kind: "MATCH_BUY_anonFilters", userId: "42" });
    expect(parseStarsPayload("garbage")).toBeNull();
    expect(starsForUsd(2)).toBe(200);
    expect(usdForStars(50)).toBe(0.5);
  });
});

describe("revenue report: real money vs internal credit", () => {
  it("counts only provider-confirmed money as real", () => {
    expect(isRealDeposit({ type: "DEPOSIT", status: "COMPLETED", txHash: "ch_1" })).toBe(true);
    expect(isRealDeposit({ type: "DEPOSIT", status: "COMPLETED", txHash: null })).toBe(false);
    expect(isRealDeposit({ type: "AD_PAYMENT", status: "COMPLETED", txHash: "x" })).toBe(false);
    const r = summarize(30, [
      { source: "بوت الزواج · DEPOSIT", currency: "stars", amount: 0.5, count: 1, real: true, at: new Date("2026-11-09") },
      { source: "بوت الزواج · DEPOSIT", currency: "stars", amount: 2, count: 1, real: true, at: new Date("2026-11-10") },
      { source: "بنرات الموقع", currency: "USD", amount: 15, count: 1, real: true },
      { source: "المحفظة/الإعلانات · AD_PAYMENT", currency: "internal", amount: 4, count: 1, real: false },
      { source: "x", currency: "internal", amount: 0, count: 1, real: false },
    ]);
    expect(r).toMatchObject({ realUsd: 17.5, realCount: 3, internalUsd: 4, internalCount: 1, lastRealAt: "2026-11-10T00:00:00.000Z" });
    expect(r.bySource[0]).toMatchObject({ source: "بنرات الموقع", real: true });
  });
});

describe("⭐ Telegram Stars → site ad (site bot)", () => {
  const hook = (update: any, secret = "hook-secret") => siteBotHook({ json: async () => update, headers: { get: (h: string) => (h === "x-telegram-bot-api-secret-token" ? secret : null) } } as any);
  const pay = (body: any) => adsPay({ json: async () => body } as any);
  const pcq = (amount: number) => ({ pre_checkout_query: { id: "q1", currency: "XTR", total_amount: amount, invoice_payload: "SITEAD:ADV-STAR" } });
  const paid = (amount: number, charge = "ch_1") => ({ message: { chat: { id: 42 }, from: { id: 42 }, successful_payment: { currency: "XTR", total_amount: amount, invoice_payload: "SITEAD:ADV-STAR", telegram_payment_charge_id: charge } } });
  beforeEach(() => {
    db.siteBannerAd.update = jest.fn(async () => ({}));
    state.ads.set("ADV-STAR", { reservationCode: "ADV-STAR", totalPrice: 15, durationDays: 7, altText: "متجري", kind: "sponsor", placement: "zakat-calculator", targetUrl: "https://shop.example", paymentStatus: "PENDING", adStatus: "PENDING_PAYMENT", credited: false });
  });
  it("issues a 1500⭐ invoice for a $15 order", async () => {
    const r: any = await pay({ code: "ADV-STAR", method: "stars" });
    expect(r.body).toMatchObject({ invoiceUrl: "https://t.me/$inv123", stars: 1500 });
    const inv = tg.find((c) => c.method === "createInvoiceLink")!.body;
    expect(inv).toMatchObject({ currency: "XTR", payload: "SITEAD:ADV-STAR", prices: [{ amount: 1500 }] });
  });
  it("is refused when the webhook secret is not configured (a fake payment could not be told apart)", async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    expect((await pay({ code: "ADV-STAR", method: "stars" })).status).toBe(400);
    await hook(paid(1500), "");
    expect(state.ads.get("ADV-STAR").paymentStatus).toBe("PENDING");
  });
  it("pre-checkout: accepts the full price, rejects an underpayment", async () => {
    await hook(pcq(1500));
    await hook(pcq(100));
    const answers = tg.filter((c) => c.method === "answerPreCheckoutQuery").map((c) => c.body.ok);
    expect(answers).toEqual([true, false]);
  });
  it("a confirmed payment marks the ad paid once, credits revenue once and sends the payer a report link", async () => {
    await hook(paid(1500));
    await hook(paid(1500)); // redelivery
    expect(state.ads.get("ADV-STAR")).toMatchObject({ paymentStatus: "PAID", adStatus: "PENDING_APPROVAL", credited: true });
    expect(state.revenue).toBe(15);
    expect(state.notified).toHaveLength(1);
    const reply = tg.find((c) => c.method === "sendMessage" && c.body.chat_id === 42)!.body.text;
    expect(reply).toContain("/advertise/report?c=ADV-STAR&s=");
  });
  it("forged webhook (wrong secret) and underpaid payments change nothing", async () => {
    expect((await hook(paid(1500), "wrong")).status).toBe(401);
    await hook(paid(10));
    expect(state.ads.get("ADV-STAR").paymentStatus).toBe("PENDING");
    expect(state.revenue).toBe(0);
  });
});
