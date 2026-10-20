// The platform owner's own Stars payment used to be dropped: his messages took a text-only admin path that returned before the
// successful_payment handler. A payment must be credited before every gate, for the owner, a muted user and a banned one alike.
process.env.SUPER_ADMIN_TELEGRAM_ID = "999";

const db: any = {
  matchUser: { upsert: jest.fn(async () => ({ id: "x" })), findUnique: jest.fn(async () => ({ balance: 5 })), update: jest.fn() },
  matchProfile: { findUnique: jest.fn(async () => null) },
  jobsUser: { upsert: jest.fn(async () => ({ id: "x" })), findUnique: jest.fn(async () => ({ balance: 5 })), update: jest.fn() },
  confessionUser: { upsert: jest.fn(async () => ({ id: "x" })), findUnique: jest.fn(async () => ({ balance: 5 })), update: jest.fn() },
  $queryRaw: jest.fn(async () => []), $executeRaw: jest.fn(), $executeRawUnsafe: jest.fn(), $transaction: jest.fn(),
};
jest.mock("@/lib/prisma", () => ({ prisma: db }));
jest.mock("next/server", () => ({ after: (fn: () => unknown) => fn(), NextResponse: { json: (b: unknown) => b } }));
const credit = jest.fn(async () => "ok");
jest.mock("@/lib/starsPayment", () => ({ ...jest.requireActual("@/lib/starsPayment"), creditStarsPayment: (...a: unknown[]) => (credit as any)(...a) }));
jest.mock("grammy", () => {
  class Kb { text() { return this; } row() { return this; } resized() { return this; } url() { return this; } webApp() { return this; } }
  return { Bot: class { api = { sendMessage: jest.fn(async () => ({})) }; }, Keyboard: Kb, InlineKeyboard: Kb };
});

import { handleMarriageBotUpdate } from "@/lib/matchBotLogic";
import { handleJobsBotUpdate } from "@/lib/jobsBotLogic";
import { handleConfessionBotUpdate } from "@/lib/confessionBotLogic";

const bot = () => ({ api: { sendMessage: jest.fn(async () => ({})) } }) as any;
const row = { id: "b1", token: "t", ownerId: "999" } as any;
const pay = (from: string, payload: string) => ({ message: { from: { id: Number(from) }, chat: { id: Number(from), type: "private" }, successful_payment: { invoice_payload: payload, total_amount: 300, telegram_payment_charge_id: "chg" + from } } });

beforeEach(() => { credit.mockClear(); });

describe("Stars payments are credited before the admin/ban gates", () => {
  it("marriage bot: the owner's deposit is credited (and a normal user's too)", async () => {
    await handleMarriageBotUpdate(bot(), row, pay("999", "MATCH_DEPOSIT:999"));
    await handleMarriageBotUpdate(bot(), row, pay("123", "MATCH_DEPOSIT:123"));
    expect(credit).toHaveBeenCalledTimes(2);
    expect((credit.mock.calls[0] as unknown[])[0]).toBe("match-stars");
  });
  it("marriage bot: the one-tap buy payload is credited for the owner as well", async () => {
    await handleMarriageBotUpdate(bot(), row, pay("999", "MATCH_BUY_boost:999"));
    expect((credit.mock.calls[0] as unknown[])[0]).toBe("match-stars-buy");
  });
  it("a payment whose payload names someone else is not credited to the payer", async () => {
    await handleMarriageBotUpdate(bot(), row, pay("999", "MATCH_DEPOSIT:123"));
    expect(credit).not.toHaveBeenCalled();
  });
  it("jobs bot and confession bot: the owner's deposit is credited", async () => {
    await handleJobsBotUpdate(bot(), row, pay("999", "JOBS_DEPOSIT:999"));
    await handleConfessionBotUpdate(bot(), row, pay("999", "CONFESSION_DEPOSIT:999"));
    expect(credit).toHaveBeenCalledTimes(2);
  });
});
