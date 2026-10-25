// Athar Stars: the pure decisions (prices, dates, addresses, pre-checkout) and the "off by default" guarantees. The database is not touched here.
jest.mock("@/lib/prisma", () => ({ prisma: { $executeRawUnsafe: jest.fn(), $queryRawUnsafe: jest.fn(async () => []) } }));
import { sweep, decidePreCheckout, isOrderPayload, isTaken, parseDateIndex, parseRecipient, starsEnabled, starsPrices, dateText, type Order } from "../atharStars";
import { handleStarsMessage, isPaySupport } from "../atharStarsBot";

const order = (o: Partial<Order> = {}): Order => ({
  id: "11111111-2222-3333-4444-555555555555", bot_id: "b", tg_user_id: "42", date_index: 100, tier: "silver", stars_amount: 750, recipient_address: "x", status: "pending",
  telegram_payment_charge_id: null, mint_tx_hash: null, mint_claimed_by: null, mint_claimed_at: null, created_at: new Date(), paid_at: null, minted_at: null, refunded_at: null, last_error: null, ...o,
});
const good = { enabled: true, order: order(), fromId: "42", total: 750, currency: "XTR", lockHeld: true, taken: false as boolean | null };

describe("flag and prices", () => {
  it("is off unless ATHAR_ENABLE_STARS=1", () => {
    delete process.env.ATHAR_ENABLE_STARS; expect(starsEnabled()).toBe(false);
    process.env.ATHAR_ENABLE_STARS = "true"; expect(starsEnabled()).toBe(false);
    process.env.ATHAR_ENABLE_STARS = "1"; expect(starsEnabled()).toBe(true);
    delete process.env.ATHAR_ENABLE_STARS;
  });
  it("reads prices from the server setting and falls back on anything odd", () => {
    expect(starsPrices(undefined)).toEqual({ normal: 250, silver: 750, gold: 2000 });
    expect(starsPrices("300,900,2500")).toEqual({ normal: 300, silver: 900, gold: 2500 });
    expect(starsPrices('{"normal":1,"silver":2,"gold":3}')).toEqual({ normal: 1, silver: 2, gold: 3 });
    expect(starsPrices("0,5,5")).toEqual({ normal: 250, silver: 750, gold: 2000 });
    expect(starsPrices("a,b,c")).toEqual({ normal: 250, silver: 750, gold: 2000 });
    expect(starsPrices("{bad")).toEqual({ normal: 250, silver: 750, gold: 2000 });
  });
});

describe("date and address input", () => {
  it("needs a real date with a year inside 1950-2049", () => {
    expect(parseDateIndex("14/3/2003")).toBe(19430);
    expect(dateText(19430)).toBe("14/3/2003");
    expect(parseDateIndex("14/3")).toBeNull();
    expect(parseDateIndex("31/2/2003")).toBeNull();
    expect(parseDateIndex("1/1/1940")).toBeNull();
    expect(parseDateIndex("hello")).toBeNull();
  });
  it("accepts a TON address and rejects text", () => {
    expect(parseRecipient("UQBt3hzFFJ11GjBjzD523m3NnyhqRNyfKCmzVq9_zVfjQJSz")).toMatch(/^UQ/);
    expect(parseRecipient("not an address")).toBeNull();
    expect(parseRecipient("UQBt3hzFFJ11GjBjzD523m3NnyhqRNyfKCmzVq9_zVfjQJSA")).toBeNull();   // wrong checksum
  });
});

describe("pre_checkout decision", () => {
  it("approves only when every condition holds", () => {
    expect(decidePreCheckout(good).ok).toBe(true);
  });
  it.each([
    ["flag off", { enabled: false }], ["no order", { order: null }], ["order already paid", { order: order({ status: "paid" }) }],
    ["another buyer", { fromId: "43" }], ["wrong amount", { total: 1 }], ["wrong currency", { currency: "USD" }], ["lock lost", { lockHeld: false }],
    ["taken on chain", { taken: true }], ["chain cannot be checked", { taken: null }],
  ])("refuses: %s", (_n, patch) => {
    const r = decidePreCheckout({ ...good, ...(patch as object) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message.length).toBeGreaterThan(5);
  });
  it("tells an order id from any other invoice payload", () => {
    expect(isOrderPayload("11111111-2222-3333-4444-555555555555")).toBe(true);
    expect(isOrderPayload("MATCH_DEPOSIT:12")).toBe(false);
  });
});

describe("isTaken", () => {
  const f = (j: unknown, ok = true) => (async () => ({ ok, json: async () => j })) as unknown as typeof fetch;
  it("reads the kind of the date, treats auctions as not for sale, and never guesses", async () => {
    expect(await isTaken("s", 1, "silver", f({ onChain: true, taken: [true, false, false] }))).toBe(false);
    expect(await isTaken("s", 1, "normal", f({ onChain: true, taken: [true, false, false] }))).toBe(true);
    expect(await isTaken("s", 1, "gold", f({ onChain: true, taken: [false, false, false], auction: [false, false, true] }))).toBe(true);
    expect(await isTaken("s", 1, "gold", f({ onChain: false, taken: [] }))).toBeNull();
    expect(await isTaken("s", 1, "gold", f({}, false))).toBeNull();
    expect(await isTaken("s", 1, "gold", (async () => { throw new Error("down"); }) as unknown as typeof fetch)).toBeNull();
  });
});

describe("the bot while the flag is off", () => {
  it("ignores /stars and the button, so the bot behaves as before", async () => {
    delete process.env.ATHAR_ENABLE_STARS;
    const sent: unknown[] = [];
    const bot = { api: { sendMessage: async (...a: unknown[]) => { sent.push(a); } } } as any;
    expect(await handleStarsMessage(bot, "b", { chat: { id: 1 }, from: { id: 42 }, text: "/stars" }, "en")).toBe(false);
    expect(await handleStarsMessage(bot, "b", { chat: { id: 1 }, from: { id: 42 }, text: "⭐ Gift with Stars" }, "en")).toBe(false);
    expect(sent).toHaveLength(0);
  });
  it("asks for the date when the flag is on", async () => {
    process.env.ATHAR_ENABLE_STARS = "1";
    const sent: any[] = [];
    const bot = { api: { sendMessage: async (...a: unknown[]) => { sent.push(a); } } } as any;
    expect(await handleStarsMessage(bot, "b", { chat: { id: 1 }, from: { id: 42 }, text: "/stars" }, "en")).toBe(true);
    expect(sent[0][1]).toMatch(/date of your token/);
    delete process.env.ATHAR_ENABLE_STARS;
  });
});

describe("/paysupport (Telegram Bot Developer Terms 6.2.1)", () => {
  const api = () => ({ sendMessage: jest.fn(async () => ({})) });
  it("recognises the command", () => { expect(isPaySupport("/paysupport")).toBe(true); expect(isPaySupport("/paysupport@AtharDaysBot")).toBe(true); expect(isPaySupport("/pay")).toBe(false); });
  it("answers even while Stars are off", async () => {
    delete process.env.ATHAR_ENABLE_STARS; const a = api();
    expect(await handleStarsMessage({ api: a } as any, "b", { chat: { id: 5 }, from: { id: 5 }, text: "/paysupport" }, "en")).toBe(true);
    expect(a.sendMessage).toHaveBeenCalledTimes(1);
  });
  it("passes a reply to the owner and thanks the user", async () => {
    delete process.env.ATHAR_ENABLE_STARS; const a = api();
    const msg = { chat: { id: 5 }, from: { id: 5, username: "u" }, text: "where is my token", reply_to_message: { text: "x\nref: paysupport" } };
    expect(await handleStarsMessage({ api: a } as any, "b", msg, "en")).toBe(true);
    expect(a.sendMessage).toHaveBeenCalledTimes(2);
  });
});

describe("sweep SQL", () => {
  it("casts interval parameters (Prisma sends numbers as bigint; make_interval(mins/days) needs int)", async () => {
    const { prisma } = jest.requireMock("@/lib/prisma");
    prisma.$queryRawUnsafe.mockClear(); prisma.$executeRawUnsafe.mockClear();
    await sweep(() => null, "https://athar.example");
    const sql = [...prisma.$queryRawUnsafe.mock.calls, ...prisma.$executeRawUnsafe.mock.calls].map((c: any[]) => String(c[0])).join("\n");
    expect(sql).toMatch(/make_interval\(mins => \$1::int\)/);
    expect(sql).toMatch(/make_interval\(days => \$1::int\)/);
    expect(sql).not.toMatch(/make_interval\((mins|days) => \$\d\)/);
  });
});
