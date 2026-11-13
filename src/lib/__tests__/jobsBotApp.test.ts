// The jobs & store bot's own Mini App (@Saragptbotbot, JOBS_BOT): auth per bot, the same gates as the chat (ban, phone,
// profile), and the money/order paths shared by chat and app (src/lib/jobs/core.ts): accepting an offer holds the buyer's
// balance exactly once, receipt releases it once and closes a pending dispute, a sold listing cannot be rewritten.
import { NextRequest } from "next/server";
import { signInitData } from "@/lib/match/inline";

const TOKEN_J = "444:JJJ-test-token-jobs";
const TOKEN_A = "111:AAA-test-token-a";
const bots: Record<string, any> = {
  "bot-j": { id: "bot-j", token: TOKEN_J, isActive: true, template: "JOBS_BOT", ownerId: "900", requiredChannel: null },
  "bot-a": { id: "bot-a", token: TOKEN_A, isActive: true, template: "AD_BOT", ownerId: "900" },
};

// ---------------------------------------------------------------- a tiny in-memory Prisma (enough for the paths under test)
type Row = Record<string, any>;
const tables: Record<string, Map<string, Row>> = {};
const T = (n: string) => (tables[n] ||= new Map());
let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
function matches(row: Row, where: any): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, cond]: [string, any]) => {
    if (k === "OR") return (cond as any[]).some((c) => matches(row, c));
    if (k === "AND") return (cond as any[]).every((c) => matches(row, c));
    const v = row[k];
    if (cond && typeof cond === "object" && !(cond instanceof Date) && !Array.isArray(cond)) {
      if ("in" in cond && !cond.in.includes(v)) return false;
      if ("notIn" in cond && cond.notIn.includes(v)) return false;
      if ("not" in cond && (typeof cond.not === "object" && cond.not ? matches(row, { [k]: cond.not }) : v === cond.not)) return false;
      if ("gte" in cond && !(v >= cond.gte)) return false;
      if ("gt" in cond && !(v > cond.gt)) return false;
      if ("lt" in cond && !(v < cond.lt)) return false;
      if ("contains" in cond && !String(v || "").toLowerCase().includes(String(cond.contains).toLowerCase())) return false;
      return true;
    }
    return v === cond;
  });
}
function apply(row: Row, data: Row) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === "object" && "increment" in v) row[k] = (row[k] || 0) + v.increment;
    else if (v && typeof v === "object" && "decrement" in v) row[k] = (row[k] || 0) - v.decrement;
    else row[k] = v;
  }
  return row;
}
const keyOf = (name: string, where: any) => {
  if (where.id) return where.id;
  if (where.userId) return where.userId;
  if (where.orderId) return where.orderId;
  const k = Object.values(where)[0] as any;
  return typeof k === "object" ? Object.values(k).join(":") : String(k);
};
const DEFAULTS: Record<string, Row> = { storeOffer: { status: "PENDING" }, jobsDispute: { status: "OPEN", buyerStatement: null, sellerStatement: null }, storeListing: { status: "ACTIVE" }, jobsTransaction: {} };
function model(name: string, idField = "id") {
  const t = () => T(name);
  return {
    findUnique: jest.fn(async ({ where }: any) => { const r = t().get(keyOf(name, where)); return r ? { ...r } : null; }),
    findFirst: jest.fn(async ({ where }: any = {}) => { const r = [...t().values()].find((x) => matches(x, where)); return r ? { ...r } : null; }),
    findMany: jest.fn(async ({ where, take }: any = {}) => [...t().values()].filter((x) => matches(x, where)).slice(0, take || 1000).map((x) => ({ ...x }))),
    count: jest.fn(async ({ where }: any = {}) => [...t().values()].filter((x) => matches(x, where)).length),
    create: jest.fn(async ({ data }: any) => { const r = { created_at: new Date(), updated_at: new Date(), ...DEFAULTS[name], ...data }; if (!r[idField]) r[idField] = uuid(); t().set(r[idField], r); return { ...r }; }),
    update: jest.fn(async ({ where, data }: any) => { const r = t().get(keyOf(name, where)); if (!r) throw new Error(`${name} not found`); return { ...apply(r, data) }; }),
    updateMany: jest.fn(async ({ where, data }: any) => { const rows = [...t().values()].filter((x) => matches(x, where)); rows.forEach((r) => apply(r, data)); return { count: rows.length }; }),
    upsert: jest.fn(async ({ where, create, update }: any) => {
      const k = keyOf(name, where);
      const r = t().get(k);
      if (r) return { ...apply(r, update || {}) };
      const n = { created_at: new Date(), updated_at: new Date(), ...DEFAULTS[name], ...create };
      if (!n[idField]) n[idField] = k;
      t().set(k, n);
      return { ...n };
    }),
  };
}
let lock: Promise<void> = Promise.resolve();
const db: any = {
  bot: { findUnique: jest.fn(async ({ where }: any) => bots[where.id] || null) },
  jobsUser: model("jobsUser"), jobsProfile: model("jobsProfile", "userId"), storeListing: model("storeListing"), storeWantedListing: model("storeWantedListing"),
  storeOffer: model("storeOffer"), storeOrder: model("storeOrder"), jobsDispute: model("jobsDispute", "orderId"), jobsTransaction: model("jobsTransaction"),
  jobsBlock: model("jobsBlock"), jobsTender: model("jobsTender"), jobsTenderBid: model("jobsTenderBid"),
  $queryRaw: jest.fn(async () => []), $executeRaw: jest.fn(async () => 0),
  // Serialised like a real DB transaction, and rolled back when the callback throws.
  $transaction: jest.fn(async (fn: any) => {
    const prev = lock;
    let release!: () => void;
    lock = new Promise((r) => (release = r));
    await prev;
    const snap = Object.fromEntries(Object.entries(tables).map(([k, m]) => [k, new Map([...m].map(([id, r]) => [id, { ...r }]))]));
    try { return await fn(db); } catch (e) { for (const k of Object.keys(tables)) tables[k] = snap[k] || new Map(); throw e; } finally { release(); }
  }),
};
jest.mock("@/lib/prisma", () => ({ prisma: db }));

const api = {
  getMe: jest.fn(async () => ({ username: "Saragptbotbot" })),
  getChatMember: jest.fn(async () => ({ status: "member" })),
  createInvoiceLink: jest.fn(async () => "https://t.me/$jobs"),
  sendMessage: jest.fn(async () => ({})),
  answerCallbackQuery: jest.fn(async () => true),
};
jest.mock("grammy", () => {
  const actual = jest.requireActual("grammy");
  return { ...actual, Bot: jest.fn().mockImplementation(() => ({ api })) };
});
jest.mock("@/lib/botApp/adApp", () => ({ handleAdAppAction: jest.fn(async () => ({ ok: true, app: "ad" })) }));
jest.mock("@/lib/botApp/streakApp", () => ({ handleStreakAppAction: jest.fn(async () => ({ ok: true, app: "streak" })) }));
const mockSetBotAppMenu = jest.fn(async () => true);
jest.mock("@/lib/builderOwnerBot", () => ({
  ...jest.requireActual("@/lib/builderOwnerBot"),
  setBotAppMenu: (...args: any[]) => mockSetBotAppMenu(...args),
}));
jest.mock("@/lib/hostingOps", () => ({
  ...jest.requireActual("@/lib/hostingOps"),
  gateUrl: () => "https://mini-app.test",
}));

import { POST } from "@/app/api/bot-app/[botId]/route";
import { POST as UPLOAD } from "@/app/api/bot-app/[botId]/upload/route";
import { GET as PHOTO } from "@/app/api/bot-app/[botId]/photo/route";
import { handleJobsAppAction } from "@/lib/botApp/jobsApp";
import { acceptOfferCore, confirmReceivedCore, createOfferCore, saveListingCore, submitDisputeCore, openDisputeCore, settleEscrow } from "@/lib/jobs/core";
import { handleJobsBotUpdate } from "@/lib/jobsBotLogic";

const initFor = (token: string, id = 4242) =>
  signInitData({ auth_date: String(Math.floor(Date.now() / 1000) - 30), query_id: "q1", user: JSON.stringify({ id, first_name: "Sam", username: "sam" }) }, token);
const call = (botId: string, body: any) =>
  POST(new NextRequest(`https://x.test/api/bot-app/${botId}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }), { params: Promise.resolve({ botId }) });
const tgUser = (id: string) => ({ id, firstName: "U", username: "u" }) as any;
const profile = (userId: string, roleType = "TRADER") => T("jobsProfile").set(userId, { userId, name: `P${userId}`, age: 30, country: "SY", governorate: "Damascus", city: "Damascus", contactMethod: "TELEGRAM", contactValue: `u${userId}`, roleType, isPaused: false, professionalCategory: roleType === "PROFESSIONAL" ? "سباكة" : null });
const user = (id: string, balance = 0, extra: Row = {}) => T("jobsUser").set(id, { id, botId: "bot-j", balance, phoneVerified: true, isBanned: false, mutedUntil: null, pendingAction: null, ...extra });
const listing = (sellerId: string, price = 50, extra: Row = {}) => { const id = uuid(); T("storeListing").set(id, { id, sellerId, title: "هاتف", description: "", price, photoFileIds: [], deliveryMethod: "SHIPPING", paymentMethod: "ESCROW", status: "ACTIVE", created_at: new Date(), ...extra }); return id; };
const orders = () => [...T("storeOrder").values()];
const holds = () => [...T("jobsTransaction").values()].filter((t) => t.type === "ESCROW_HOLD");
const feeHolds = () => [...T("jobsTransaction").values()].filter((t) => t.type === "PLATFORM_FEE_PENDING");
const fees = () => [...T("jobsTransaction").values()].filter((t) => t.type === "PLATFORM_FEE");

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  jest.clearAllMocks();
});

describe("jobs Mini App auth and gates", () => {
  it("a JOBS_BOT gets its own app signed with ITS token; another bot's initData is refused", async () => {
    user("4242", 3); profile("4242");
    const res = await call("bot-j", { initData: initFor(TOKEN_J), action: "init", userId: "1" });
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j).toMatchObject({ ok: true, user: { id: "4242" }, balance: 3, phoneVerified: true, profile: { roleType: "TRADER" } });
    expect((await call("bot-j", { initData: initFor(TOKEN_A), action: "init" })).status).toBe(401);
  });
  it("same gates as the chat: banned, unverified phone, missing profile", async () => {
    user("1", 0, { isBanned: true });
    expect(await handleJobsAppAction(bots["bot-j"], tgUser("1"), "store_list", {})).toMatchObject({ ok: false, code: "banned" });
    user("2", 0, { phoneVerified: false }); profile("2");
    expect(await handleJobsAppAction(bots["bot-j"], tgUser("2"), "store_list", {})).toMatchObject({ ok: false, code: "phone" });
    user("3");
    expect(await handleJobsAppAction(bots["bot-j"], tgUser("3"), "store_list", {})).toMatchObject({ ok: false, code: "profile" });
    const saved: any = await handleJobsAppAction(bots["bot-j"], tgUser("3"), "profile_save", { profile: { name: "سامي", age: "25", country: "سوريا", governorate: "حلب", city: "حلب", contactMethod: "TELEGRAM", contactValue: "@sami", roleType: "TRADER" } });
    expect(saved).toMatchObject({ ok: true, profile: { roleType: "TRADER", contactValue: "sami" } });
  });
  it("Stars deposit uses the chat's JOBS_DEPOSIT:<user> payload, XTR, only the listed tiers", async () => {
    user("5"); profile("5");
    expect(await handleJobsAppAction(bots["bot-j"], tgUser("5"), "stars_invoice", { stars: 300 })).toMatchObject({ ok: true, link: "https://t.me/$jobs" });
    const [, , payload, provider, currency, prices] = api.createInvoiceLink.mock.calls[0] as any[];
    expect([payload, provider, currency, prices[0].amount]).toEqual(["JOBS_DEPOSIT:5", "", "XTR", 300]);
    expect((await handleJobsAppAction(bots["bot-j"], tgUser("5"), "stars_invoice", { stars: 7 })).ok).toBe(false);
  });
  it("upload: initData of this bot only, and only for verified users", async () => {
    const up = (initData: string) => { const fd = new FormData(); fd.set("initData", initData); fd.set("file", new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }), "a.jpg"); return UPLOAD(new NextRequest("https://x.test/u", { method: "POST", body: fd }), { params: Promise.resolve({ botId: "bot-j" }) }); };
    expect((await up(initFor(TOKEN_A))).status).toBe(401);
    user("4242", 0, { phoneVerified: false });
    expect((await up(initFor(TOKEN_J))).status).toBe(403);
  });
  it("photo proxy serves only photos of this bot's listings (never an arbitrary file id)", async () => {
    const f = jest.fn();
    (global as any).fetch = f;
    const res = await PHOTO(new NextRequest("https://x.test/p?f=AgACAgQAAxkBAAIBc2Zfake_file_id_123"), { params: Promise.resolve({ botId: "bot-j" }) });
    expect(res.status).toBe(404);
    expect(f).not.toHaveBeenCalled();
    expect((await PHOTO(new NextRequest("https://x.test/p?f=AgACAgQAAxkBAAIBc2Zfake_file_id_123"), { params: Promise.resolve({ botId: "bot-a" }) })).status).toBe(404);
  });
});

describe("offers and escrow (shared by chat and app)", () => {
  it("a double tap on «accept» holds the buyer's money once and creates one order", async () => {
    user("b", 100); user("s"); profile("b"); profile("s");
    const lid = listing("s", 60);
    const o: any = await createOfferCore("b", "LISTING", lid, "60");
    const [x, y] = await Promise.all([acceptOfferCore("s", o.offer.id), acceptOfferCore("s", o.offer.id)]);
    expect([x.ok, y.ok].filter(Boolean)).toHaveLength(1);
    expect(orders()).toHaveLength(1);
    expect(holds()).toHaveLength(1);
    expect(feeHolds()).toHaveLength(1);
    expect(feeHolds()[0]).toMatchObject({ userId: "s", amount: 3, status: "PENDING", txHash: orders()[0].id });
    expect(T("jobsUser").get("b")!.balance).toBe(40);
    expect(T("storeListing").get(lid)!.status).toBe("SOLD");
  });
  it("two offers on the same listing accepted at once: one sale, the other buyer is not charged and is rejected", async () => {
    user("b1", 100); user("b2", 100); user("s");
    const lid = listing("s", 30);
    const o1: any = await createOfferCore("b1", "LISTING", lid, "30");
    const o2: any = await createOfferCore("b2", "LISTING", lid, "35");
    const r = await Promise.all([acceptOfferCore("s", o1.offer.id), acceptOfferCore("s", o2.offer.id)]);
    expect(r.filter((x) => x.ok)).toHaveLength(1);
    expect(orders()).toHaveLength(1);
    expect(T("jobsUser").get("b1")!.balance + T("jobsUser").get("b2")!.balance).toBe(200 - orders()[0].amount);
    expect([...T("storeOffer").values()].map((o) => o.status).sort()).toEqual(["ACCEPTED", "REJECTED"]);
  });
  it("insufficient balance: nothing is charged or sold, the offer is rejected", async () => {
    user("b", 10); user("s");
    const lid = listing("s", 60);
    const o: any = await createOfferCore("b", "LISTING", lid, "60");
    const r = await acceptOfferCore("s", o.offer.id);
    expect(r).toMatchObject({ ok: false, reason: "balance" });
    expect(orders()).toHaveLength(0);
    expect(holds()).toHaveLength(0);
    expect(T("jobsUser").get("b")!.balance).toBe(10);
    expect(T("storeListing").get(lid)!.status).toBe("ACTIVE");
    expect(T("storeOffer").get(o.offer.id)!.status).toBe("REJECTED");
  });
  it("only the other party may accept (the one who made the last price cannot accept it)", async () => {
    user("b", 100); user("s");
    const o: any = await createOfferCore("b", "LISTING", listing("s", 20), "20");
    expect(await acceptOfferCore("b", o.offer.id)).toMatchObject({ ok: false, reason: "not_allowed" });
    expect(orders()).toHaveLength(0);
  });
  it("the app's offer_accept notifies both sides in the chat", async () => {
    user("101", 100); user("202"); profile("101"); profile("202");
    const o: any = await createOfferCore("101", "LISTING", listing("202", 20), "20");
    const r: any = await handleJobsAppAction(bots["bot-j"], tgUser("202"), "offer_accept", { id: o.offer.id });
    expect(r).toMatchObject({ ok: true, mode: "escrow" });
    const to = api.sendMessage.mock.calls.map((c: any[]) => String(c[0]));
    expect(to).toEqual(expect.arrayContaining(["101", "202"]));
    expect(T("jobsUser").get("101")!.balance).toBe(80);
  });
});

describe("receipt and disputes", () => {
  const escrowed = () => {
    user("b", 0); user("s", 0);
    const lid = listing("s", 25, { status: "SOLD" });
    const id = uuid();
    T("storeOrder").set(id, { id, buyerId: "b", sellerId: "s", listingId: lid, amount: 25, deliveryMethod: "SHIPPING", status: "ESCROWED", escrowedAt: new Date(), created_at: new Date() });
    const fee = Math.round(25 * 5) / 100;
    const feeId = uuid();
    T("jobsTransaction").set(feeId, { id: feeId, userId: "s", amount: fee, currency: "internal", type: "PLATFORM_FEE_PENDING", status: "PENDING", txHash: id });
    return id;
  };
  it("confirming receipt pays the seller once and closes a pending dispute", async () => {
    const id = escrowed();
    await openDisputeCore("b", id);
    const released: any = await confirmReceivedCore("b", id);
    expect(released).toMatchObject({ ok: true, platformFee: 1.25, sellerNet: 23.75 });
    expect((await confirmReceivedCore("b", id)).ok).toBe(false);
    expect(T("jobsUser").get("s")!.balance).toBe(23.75);
    expect(fees()).toHaveLength(1);
    expect(fees()[0]).toMatchObject({ amount: 1.25, txHash: id, status: "COMPLETED" });
    expect(T("jobsDispute").get(id)).toMatchObject({ status: "RESOLVED", resolution: "RELEASED_TO_SELLER" });
  });
  it("refunds the entire hold and voids the reserved commission without revenue", async () => {
    const id = escrowed();
    expect(await settleEscrow(id, "REFUNDED", "b", 25, "ESCROW_REFUND")).toBe(true);
    expect(T("jobsUser").get("b")!.balance).toBe(25);
    expect(T("jobsUser").get("s")!.balance).toBe(0);
    expect(fees()).toHaveLength(0);
    expect(feeHolds()).toHaveLength(0);
    expect([...T("jobsTransaction").values()].filter((x) => x.type === "PLATFORM_FEE_VOID")).toHaveLength(1);
  });
  it("releases legacy escrow orders in full without applying a new commission retroactively", async () => {
    user("b", 0); user("s", 0);
    const lid = listing("s", 25, { status: "SOLD" });
    const id = uuid();
    T("storeOrder").set(id, { id, buyerId: "b", sellerId: "s", listingId: lid, amount: 25, deliveryMethod: "SHIPPING", status: "ESCROWED", escrowedAt: new Date(), created_at: new Date() });
    const released: any = await confirmReceivedCore("b", id);
    expect(released).toMatchObject({ ok: true, platformFee: 0, commissionPercent: 0, sellerNet: 25 });
    expect(T("jobsUser").get("s")!.balance).toBe(25);
    expect(fees()).toHaveLength(0);
  });
  it("only the buyer confirms receipt", async () => {
    const id = escrowed();
    expect((await confirmReceivedCore("s", id)).ok).toBe(false);
    expect(T("jobsUser").get("s")!.balance).toBe(0);
  });
  it("a statement needs an open dispute on an order still in escrow", async () => {
    const id = escrowed();
    expect((await submitDisputeCore("b", id, "لم يصل", null)).ok).toBe(false);
    await openDisputeCore("b", id);
    expect((await submitDisputeCore("b", id, "لم يصل", null)).ok).toBe(true);
    expect((await submitDisputeCore("x", id, "تدخل", null)).ok).toBe(false);
  });
});

describe("listings", () => {
  it("a sold listing or someone else's cannot be rewritten; selling is for traders", async () => {
    profile("s"); profile("o"); profile("j", "SEEKER");
    const sold = listing("s", 10, { status: "SOLD" });
    const mine = listing("s", 10);
    const d = { title: "جديد", price: "12", deliveryMethod: "SHIPPING", paymentMethod: "ESCROW" };
    expect((await saveListingCore("s", d, sold)).ok).toBe(false);
    expect((await saveListingCore("o", d, mine)).ok).toBe(false);
    expect((await saveListingCore("j", d)).ok).toBe(false);
    expect(await saveListingCore("s", { ...d, paymentMethod: "MANUAL" })).toMatchObject({ ok: false, error: expect.stringContaining("الحجز الآمن") });
    expect(await saveListingCore("s", d, mine)).toMatchObject({ ok: true, created: false });
    expect(T("storeListing").get(mine)!.price).toBe(12);
  });
  it("a zero-percent commission remains zero even if the environment changes before receipt", async () => {
    user("b", 100); user("s");
    const lid = listing("s", 60);
    const offer: any = await createOfferCore("b", "LISTING", lid, "60");
    const original = process.env.JOBS_STORE_COMMISSION_PERCENT;
    process.env.JOBS_STORE_COMMISSION_PERCENT = "0";
    try {
      const accepted: any = await acceptOfferCore("s", offer.offer.id);
      expect(accepted.ok).toBe(true);
      expect(feeHolds()).toHaveLength(1);
      expect(feeHolds()[0].amount).toBe(0);
      process.env.JOBS_STORE_COMMISSION_PERCENT = "12";
      const released: any = await confirmReceivedCore("b", accepted.orderId);
      expect(released).toMatchObject({ ok: true, platformFee: 0, commissionPercent: 0, sellerNet: 60 });
      expect(T("jobsUser").get("s")!.balance).toBe(60);
    } finally {
      if (original === undefined) delete process.env.JOBS_STORE_COMMISSION_PERCENT;
      else process.env.JOBS_STORE_COMMISSION_PERCENT = original;
    }
  });
  it("a legacy manual listing cannot complete an offer or reveal contact details", async () => {
    user("b", 100); user("s"); profile("b"); profile("s");
    const lid = listing("s", 30, { paymentMethod: "MANUAL" });
    const offer: any = await createOfferCore("b", "LISTING", lid, "30");
    const result = await acceptOfferCore("s", offer.offer.id);
    expect(result).toMatchObject({ ok: false, reason: "unavailable" });
    expect(orders()).toHaveLength(0);
    expect(T("storeListing").get(lid)!.status).toBe("ACTIVE");
  });
  it("public wanted request details do not expose the buyer's contact before an escrow order", async () => {
    user("seller"); user("buyer"); profile("seller"); profile("buyer");
    const id = uuid();
    T("storeWantedListing").set(id, { id, buyerId: "buyer", title: "هاتف", description: "", budget: 50, status: "ACTIVE", created_at: new Date() });
    const result: any = await handleJobsAppAction(bots["bot-j"], tgUser("seller"), "wanted_get", { id });
    expect(result).toMatchObject({ ok: true, buyer: { name: "Pbuyer", contact: null } });
  });
  it("reveals store partner contact only for a funded escrow order, then hides it after settlement", async () => {
    user("buyer"); user("seller");
    profile("buyer"); profile("seller");
    const lid = listing("seller", 25, { status: "SOLD" });
    const id = uuid();
    const order = { id, buyerId: "buyer", sellerId: "seller", listingId: lid, amount: 25, deliveryMethod: "SHIPPING", status: "ESCROWED", escrowedAt: new Date(), created_at: new Date() };
    T("storeOrder").set(id, order);
    const active: any = await handleJobsAppAction(bots["bot-j"], tgUser("buyer"), "orders", {});
    expect(active.orders[0].other.contact).toBe("https://t.me/useller");
    T("storeOrder").set(id, { ...order, status: "RELEASED" });
    const settled: any = await handleJobsAppAction(bots["bot-j"], tgUser("buyer"), "orders", {});
    expect(settled.orders[0].other.contact).toBeNull();
  });
  it("price and photo ids are validated (no garbage file ids, at most 5 photos)", async () => {
    profile("s");
    expect((await saveListingCore("s", { title: "x", price: "0", deliveryMethod: "SHIPPING", paymentMethod: "ESCROW" })).ok).toBe(false);
    const ok: any = await saveListingCore("s", { title: "x", price: "3", deliveryMethod: "SHIPPING", paymentMethod: "ESCROW", photoFileIds: ["../../etc", ...Array.from({ length: 7 }, (_, i) => `AgACAgQAAxkBAAIBc2Z_photo_${i}`)] });
    expect(T("storeListing").get(ok.id)!.photoFileIds).toHaveLength(5);
    expect(T("storeListing").get(ok.id)!.photoFileIds).not.toContain("../../etc");
  });
});

describe("tenders", () => {
  it("a SERVICE tender takes quotes only from professionals of the same trade", async () => {
    user("r"); user("p"); user("t"); profile("r", "SEEKER"); profile("p", "PROFESSIONAL"); profile("t", "TRADER");
    const id = uuid();
    T("jobsTender").set(id, { id, requesterId: "r", kind: "SERVICE", category: "كهرباء", details: "تمديد كهرباء للمنزل", budget: null, status: "OPEN", expiresAt: new Date(Date.now() + 3_600_000), created_at: new Date() });
    expect((await handleJobsAppAction(bots["bot-j"], tgUser("t"), "tn_get", { id })).ok).toBe(false);
    expect((await handleJobsAppAction(bots["bot-j"], tgUser("p"), "tn_get", { id })).ok).toBe(false); // سباكة ≠ كهرباء
    expect((await handleJobsAppAction(bots["bot-j"], tgUser("r"), "tn_bid", { id, price: "5", note: "عرضي" })).ok).toBe(false);
  });
});

describe("chat callbacks", () => {
  it("a banned user can no longer act through an old inline button", async () => {
    user("77", 100, { isBanned: true });
    user("88", 100);
    const o: any = await createOfferCore("88", "LISTING", listing("77"), "50");
    jest.clearAllMocks();
    await handleJobsBotUpdate({ api } as any, bots["bot-j"], { callback_query: { id: "cq", from: { id: 77 }, data: `joffer_accept|${o.offer.id}`, message: { chat: { id: 77 } } } });
    expect(api.answerCallbackQuery).toHaveBeenCalledWith("cq", expect.objectContaining({ show_alert: true }));
    expect(db.storeOffer.updateMany).not.toHaveBeenCalled();
    expect(orders()).toHaveLength(0);
  });
});

describe("phone verification contact webhook", () => {
  it("persists the sender's own contact and the Mini App init immediately sees the verified flag", async () => {
    user("4242", 0, { phoneVerified: false });
    await handleJobsBotUpdate({ api } as any, bots["bot-j"], {
      message: {
        message_id: 901,
        chat: { id: 4242, type: "private" },
        from: { id: 4242, first_name: "Sam", username: "sam" },
        contact: { phone_number: "+963900000000", user_id: 4242, first_name: "Sam" },
      },
    });

    expect(T("jobsUser").get("4242")).toMatchObject({ phoneNumber: "+963900000000", phoneVerified: true });
    expect(api.sendMessage).toHaveBeenCalledWith(4242, expect.stringContaining("تم التحقق"), expect.any(Object));
    const refreshedResponse = await call("bot-j", { initData: initFor(TOKEN_J, 4242), action: "init" });
    expect(refreshedResponse.status).toBe(200);
    const refreshed = await refreshedResponse.json();
    expect(refreshed).toMatchObject({ ok: true, phoneVerified: true, user: { id: "4242" } });
  });

  it("does not verify a different person's contact", async () => {
    user("4242", 0, { phoneVerified: false });
    await handleJobsBotUpdate({ api } as any, bots["bot-j"], {
      message: {
        message_id: 902,
        chat: { id: 4242, type: "private" },
        from: { id: 4242, first_name: "Sam" },
        contact: { phone_number: "+963911111111", user_id: 77, first_name: "Someone else" },
      },
    });

    expect(T("jobsUser").get("4242")?.phoneVerified).toBe(false);
    expect(api.sendMessage).toHaveBeenCalledWith(4242, expect.stringContaining("يجب مشاركة رقم هاتفك أنت."));
  });
});
