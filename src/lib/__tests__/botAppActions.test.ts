// The ads & earn Mini App's server actions reuse the bot's own payment rails and wording.
const api = {
  getMe: jest.fn(async () => ({ id: 77, username: "Sham_test0_bot" })),
  createInvoiceLink: jest.fn(async (..._a: any[]) => "https://t.me/$invoice"),
  sendMessage: jest.fn(async () => ({})),
  getChatMember: jest.fn(async () => ({ status: "member" })),
};
jest.mock("grammy", () => {
  class Bot { api = api; constructor(public token: string) {} }
  class Keyboard { requestContact() { return this; } row() { return this; } text() { return this; } resized() { return this; } }
  class InlineKeyboard { text() { return this; } row() { return this; } url() { return this; } webApp() { return this; } }
  return { Bot, Keyboard, InlineKeyboard };
});
jest.mock("@/lib/prisma", () => ({ prisma: { user: { update: jest.fn(), findUnique: jest.fn(async () => ({ balance: 3 })) } } }));
jest.mock("@/lib/adBotLogic", () => ({
  ...jest.requireActual("@/lib/adBotLogic"),
  ensureUser: jest.fn(async () => ({ id: "4242", balance: 3, language: "ar", phoneVerified: true })),
  isPrivateBot: jest.fn(async () => false),
  isChannelMember: jest.fn(async () => true),
}));
const payDeal = jest.fn();
jest.mock("@/lib/channels/exchange", () => ({ ...jest.requireActual("@/lib/channels/exchange"), payDeal: (...a: any[]) => payDeal(...a) }));
const createTransferRecord = jest.fn(async (..._a: any[]) => ({ track: "HW-ABC123" }));
jest.mock("@/lib/remit/office", () => ({
  ...jest.requireActual("@/lib/remit/office"),
  apiKey: jest.fn(async () => "k"),
  quoteAmount: jest.fn(async () => ({ ok: true, quote: 98.5, min: 2 })),
  createTransferRecord: (...a: any[]) => createTransferRecord(...a),
  transferByTrack: jest.fn(async () => ({ track: "HW-ABC123", chat_id: "4242", cn_id: "x", coin: "usdtbsc", from_amount: 100, to_amount: 98.5, address: "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb", recipient: null, from_country: "tr", to_country: "sy", status: "waiting", payin: "Tpayin", payin_extra: null, payout_hash: null, created_at: new Date() })),
}));

import { handleAdAppAction } from "@/lib/botApp/adApp";

const botRow: any = { id: "af65", token: "111:test", ownerId: "900", requiredChannel: null, template: "AD_BOT", isActive: true };
const tg: any = { id: "4242", firstName: "Sam", username: "sam" };

beforeEach(() => jest.clearAllMocks());

describe("bot-app actions", () => {
  it("deposit_stars: an invoice from THIS bot with the chat's own ADBOT_DEPOSIT payload", async () => {
    const r: any = await handleAdAppAction(botRow, tg, "deposit_stars", { stars: 100 });
    expect(r).toMatchObject({ ok: true, link: "https://t.me/$invoice" });
    const args = api.createInvoiceLink.mock.calls[0] as any[];
    expect(args[2]).toBe("ADBOT_DEPOSIT:4242");
    expect(args[4]).toBe("XTR");
    expect(args[5]).toEqual([expect.objectContaining({ amount: 100 })]);
  });
  it("deposit_stars: only the bot's own Stars tiers", async () => {
    const r: any = await handleAdAppAction(botRow, tg, "deposit_stars", { stars: 7 });
    expect(r.ok).toBe(false);
    expect(api.createInvoiceLink).not.toHaveBeenCalled();
  });
  it("remit_create: the transfer belongs to the Telegram user and needs a TRC20 address", async () => {
    const bad: any = await handleAdAppAction(botRow, tg, "remit_create", { coin: "usdtbsc", amount: "100", addr: "0xabc" });
    expect(bad.ok).toBe(false);
    expect(createTransferRecord).not.toHaveBeenCalled();
    const addr = "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb";
    const ok: any = await handleAdAppAction(botRow, tg, "remit_create", { coin: "usdtbsc", amount: "100", addr, to: "sy", from: "tr", chat_id: "999" });
    expect(ok.ok).toBe(true);
    expect(createTransferRecord.mock.calls[0][0]).toBe("4242");
    expect(createTransferRecord.mock.calls[0][1]).toMatchObject({ coin: "usdtbsc", amount: 100, quote: 98.5, addr });
    expect(ok.transfer).toMatchObject({ track: "HW-ABC123", payin: "Tpayin" });
  });
  it("ex_pay (manual USDT): the user reads «المنصة», never «الأدمن»", async () => {
    payDeal.mockResolvedValue({ ok: true, manual: true, amount: 20, usdt: "Tplatform", network: "TRC20", note: "يؤكده الأدمن يدوياً." });
    const r: any = await handleAdAppAction(botRow, tg, "ex_pay", { code: "chd-abcd1234", method: "usdt" });
    expect(payDeal).toHaveBeenCalledWith("CHD-ABCD1234", "usdt", "4242");
    expect(r.note).toContain("المنصة");
    expect(r.note).not.toMatch(/الأدمن|المالك/);
  });
  it("unknown action is refused", async () => {
    expect(((await handleAdAppAction(botRow, tg, "drop_tables", {})) as any).ok).toBe(false);
  });
});
