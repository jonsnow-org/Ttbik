// Money paths shared by the ads & earn bot's chat and its Mini App (src/lib/adBotLogic.ts cores): same rules on both surfaces.
type Row = Record<string, any>;
const db = { user: [] as Row[], ad: [] as Row[], transaction: [] as Row[], bot: [] as Row[] };
const num = (v: any) => (typeof v === "object" && v !== null && "toNumber" in v ? v.toNumber() : v);
const matches = (r: Row, where: Row = {}) =>
  Object.entries(where).every(([k, v]) => {
    if (v && typeof v === "object" && "gte" in v) return num(r[k]) >= v.gte;
    if (v && typeof v === "object" && "in" in v) return v.in.includes(r[k]);
    return r[k] === v;
  });
const apply = (r: Row, data: Row) => {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === "object" && "decrement" in v) r[k] = Math.round((num(r[k]) - v.decrement) * 1e6) / 1e6;
    else if (v && typeof v === "object" && "increment" in v) r[k] = Math.round((num(r[k]) + v.increment) * 1e6) / 1e6;
    else r[k] = v;
  }
};
const table = (name: keyof typeof db) => ({
  findUnique: async ({ where }: any) => db[name].find((r) => matches(r, where)) || null,
  updateMany: async ({ where, data }: any) => { const hit = db[name].filter((r) => matches(r, where)); hit.forEach((r) => apply(r, data)); return { count: hit.length }; },
  update: async ({ where, data }: any) => { const r = db[name].find((x) => matches(x, where))!; apply(r, data); return r; },
  create: async ({ data }: any) => { const r = { id: `${name}${db[name].length + 1}`, ...data }; db[name].push(r); return r; },
});
const client: any = { user: table("user"), ad: table("ad"), transaction: table("transaction"), bot: table("bot") };
client.$transaction = async (fn: any) => fn(client);
jest.mock("@/lib/prisma", () => ({ prisma: client }));

import { AUDIT_THRESHOLD, MIN_WITHDRAWAL, cancelAdCore, launchAdCore, requestUserWithdrawalCore, round6, topupAdCore } from "@/lib/adBotLogic";

beforeEach(() => {
  db.user = [{ id: "u1", botId: "b1", balance: 10 }];
  db.ad = [];
  db.transaction = [];
});

describe("launchAdCore (➕ ضع إعلانك)", () => {
  const base = { scope: "TARGETED" as const, description: "قناة أخبار تقنية يومية", target: "@technews", budget: 4, cpc: 0.01 };
  it("charges the budget once and creates an ACTIVE ad with the usual 50/20/30 split", async () => {
    const r = await launchAdCore("u1", "TELEGRAM", base);
    expect(r).toEqual({ ok: true, budget: 4 });
    expect(db.user[0].balance).toBe(6);
    expect(db.ad).toHaveLength(1);
    expect(db.ad[0]).toMatchObject({ status: "ACTIVE", remaining: 4, totalBudget: 4, cpc: 0.01, botId: "b1", targetBotId: "b1" });
    expect(db.ad[0].workerCut + db.ad[0].creatorCut + db.ad[0].ownerCut).toBeCloseTo(0.01, 6);
    expect(db.ad[0].workerCut).toBeCloseTo(0.005, 6);
    expect(db.transaction).toEqual([expect.objectContaining({ type: "AD_PAYMENT", amount: 4 })]);
  });
  it("uses the bot handling this mini-app session, not a stale global user.botId", async () => {
    const r = await launchAdCore("u1", "TELEGRAM", base, "bot-2");
    expect(r).toEqual({ ok: true, budget: 4 });
    expect(db.ad[0]).toMatchObject({ botId: "bot-2", targetBotId: "bot-2" });
  });
  it("retains fractional-cent CPC values", () => {
    expect(round6(10 - 0.003)).toBe(9.997);
    expect(round6(9.997 - 0.003)).toBe(9.994);
  });
  it("refuses a budget above the balance without charging or creating anything", async () => {
    const r = await launchAdCore("u1", "TELEGRAM", { ...base, budget: 25 });
    expect(r).toMatchObject({ ok: false, reason: "insufficient", budget: 25, balance: 10 });
    expect(db.user[0].balance).toBe(10);
    expect(db.ad).toHaveLength(0);
    expect(db.transaction).toHaveLength(0);
  });
  it("a banned ad is stored REJECTED and never charged", async () => {
    const r = await launchAdCore("u1", "TELEGRAM", { ...base, description: "أفضل كازينو" });
    expect(r).toEqual({ ok: false, reason: "rejected" });
    expect(db.user[0].balance).toBe(10);
    expect(db.ad[0].status).toBe("REJECTED");
    expect(db.transaction).toHaveLength(0);
  });
});

describe("cancelAdCore / topupAdCore (📢 إعلاناتي)", () => {
  beforeEach(() => { db.ad = [{ id: "ad1", userId: "u1", status: "ACTIVE", remaining: 3, totalBudget: 5 }]; });
  it("cancel refunds the remaining budget exactly once", async () => {
    const snapshot = { ...db.ad[0] };
    expect(await cancelAdCore("u1", snapshot)).toBe(true);
    expect(await cancelAdCore("u1", snapshot)).toBe(false); // a repeated tap from the app or the chat
    expect(db.user[0].balance).toBe(13);
    expect(db.ad[0]).toMatchObject({ status: "CANCELLED", remaining: 0 });
    expect(db.transaction.filter((t) => t.type === "AD_REFUND")).toHaveLength(1);
  });
  it("cancel after a task was paid (stale remaining) refunds nothing", async () => {
    const stale = { ...db.ad[0] };
    db.ad[0].remaining = 2.99;
    expect(await cancelAdCore("u1", stale)).toBe(false);
    expect(db.user[0].balance).toBe(10);
  });
  it("top-up debits the balance and reopens an expired campaign", async () => {
    db.ad[0].status = "EXPIRED";
    expect(await topupAdCore("u1", db.ad[0], 4)).toBe(true);
    expect(db.user[0].balance).toBe(6);
    expect(db.ad[0]).toMatchObject({ remaining: 7, totalBudget: 9, status: "ACTIVE" });
  });
  it("top-up above the balance is refused and changes nothing", async () => {
    expect(await topupAdCore("u1", db.ad[0], 11)).toBe(false);
    expect(db.user[0].balance).toBe(10);
    expect(db.ad[0].remaining).toBe(3);
  });
});

describe("requestUserWithdrawalCore (💰 سحب)", () => {
  it("keeps the minimum", async () => {
    expect(await requestUserWithdrawalCore("u1", "TXYZ", MIN_WITHDRAWAL - 0.5)).toEqual({ ok: false, reason: "min" });
    expect(db.user[0].balance).toBe(10);
  });
  it("cannot withdraw more than the balance", async () => {
    expect(await requestUserWithdrawalCore("u1", "TXYZ", 10.5)).toMatchObject({ ok: false, reason: "insufficient", balance: 10 });
    expect(db.transaction).toHaveLength(0);
  });
  it("debits and records one pending request; above the audit threshold it is flagged", async () => {
    db.user[0].balance = 50;
    const small = await requestUserWithdrawalCore("u1", "TXYZ", 5);
    expect(small).toMatchObject({ ok: true, amount: 5, isAudit: false });
    const big = await requestUserWithdrawalCore("u1", "TXYZ", AUDIT_THRESHOLD + 1);
    expect(big).toMatchObject({ ok: true, isAudit: true });
    expect(db.user[0].balance).toBe(50 - 5 - (AUDIT_THRESHOLD + 1));
    expect(db.transaction.filter((t) => t.type === "WITHDRAWAL")).toHaveLength(2);
    expect(db.transaction.map((t) => t.status)).toEqual(["PENDING", "PENDING_AUDIT"]);
  });
});
