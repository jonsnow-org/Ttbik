// In-memory prisma stand-in: just enough updateMany/update/create semantics to prove the balance guards.
type Row = Record<string, any>;
const db = { user: [] as Row[], bot: [] as Row[], transaction: [] as Row[] };
const matches = (r: Row, where: Row) =>
  Object.entries(where).every(([k, v]) => {
    if (v && typeof v === "object" && "gte" in v) return r[k] >= v.gte;
    if (v && typeof v === "object" && "in" in v) return v.in.includes(r[k]);
    return r[k] === v;
  });
const apply = (r: Row, data: Row) => {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === "object" && "decrement" in v) r[k] -= v.decrement;
    else if (v && typeof v === "object" && "increment" in v) r[k] += v.increment;
    else r[k] = v;
  }
};
const table = (name: "user" | "bot" | "transaction") => ({
  updateMany: async ({ where, data }: any) => {
    const hit = db[name].filter((r) => matches(r, where));
    hit.forEach((r) => apply(r, data));
    return { count: hit.length };
  },
  update: async ({ where, data }: any) => {
    const r = db[name].find((x) => matches(x, where))!;
    apply(r, data);
    return r;
  },
  create: async ({ data }: any) => {
    const r = { id: `t${db.transaction.length + 1}`, ...data };
    db[name].push(r);
    return r;
  },
});
const client = { user: table("user"), bot: table("bot"), transaction: table("transaction"), $transaction: async (fn: any) => fn(client) };
jest.mock("@/lib/prisma", () => ({ prisma: client }));

import { requestWithdrawal, rejectWithdrawal, claimWithdrawal } from "@/lib/ledgerGuards";

beforeEach(() => {
  db.user = [{ id: "u1", balance: 10 }];
  db.bot = [{ id: "b1", ownerBalance: 8 }];
  db.transaction = [];
});

describe("requestWithdrawal", () => {
  it("debits the user and records a pending request", async () => {
    const r = await requestWithdrawal({ userId: "u1", amount: 4, destination: "addr", audit: false });
    expect(r.ok).toBe(true);
    expect(db.user[0].balance).toBe(6);
    expect(db.transaction[0]).toMatchObject({ type: "WITHDRAWAL", status: "PENDING", amount: 4 });
  });
  it("cannot withdraw more than the balance, even with two requests in a row", async () => {
    expect((await requestWithdrawal({ userId: "u1", amount: 7, destination: "a", audit: false })).ok).toBe(true);
    expect((await requestWithdrawal({ userId: "u1", amount: 7, destination: "a", audit: false })).ok).toBe(false);
    expect(db.user[0].balance).toBe(3);
    expect(db.transaction).toHaveLength(1);
  });
  it("owner withdrawal draws on the bot commission and is tagged for audit", async () => {
    const r = await requestWithdrawal({ userId: "u1", botId: "b1", amount: 8, destination: "a", audit: true });
    expect(r.ok).toBe(true);
    expect(db.bot[0].ownerBalance).toBe(0);
    expect(db.transaction[0]).toMatchObject({ type: "OWNER_WITHDRAWAL", status: "PENDING_AUDIT", botId: "b1" });
  });
});

describe("rejectWithdrawal", () => {
  it("refunds exactly once even if rejected twice", async () => {
    await requestWithdrawal({ userId: "u1", amount: 4, destination: "a", audit: false });
    const w = { ...db.transaction[0], botId: null } as any;
    expect(await rejectWithdrawal(w)).toBe(true);
    expect(await rejectWithdrawal(w)).toBe(false);
    expect(db.user[0].balance).toBe(10);
  });
  it("refunds a supervisor withdrawal to the bot commission", async () => {
    await requestWithdrawal({ userId: "u1", botId: "b1", amount: 5, destination: "a", audit: false });
    expect(await rejectWithdrawal(db.transaction[0] as any)).toBe(true);
    expect(db.bot[0].ownerBalance).toBe(8);
  });
  it("does not touch a request that was already approved", async () => {
    await requestWithdrawal({ userId: "u1", amount: 4, destination: "a", audit: false });
    await claimWithdrawal(db.transaction[0].id, "PENDING", "COMPLETED");
    expect(await rejectWithdrawal({ ...db.transaction[0], botId: null } as any)).toBe(false);
    expect(db.user[0].balance).toBe(6);
  });
});

describe("claimWithdrawal", () => {
  it("only one caller wins", async () => {
    await requestWithdrawal({ userId: "u1", amount: 4, destination: "a", audit: false });
    const id = db.transaction[0].id;
    expect(await claimWithdrawal(id, "PENDING", "PROCESSING")).toBe(true);
    expect(await claimWithdrawal(id, "PENDING", "PROCESSING")).toBe(false);
  });
});
