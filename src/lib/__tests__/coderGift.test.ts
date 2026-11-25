const plans = [
  { id: "free", name: { ar: "مجاني", en: "Free" }, active: true, price_stars: 0, days: 30 },
  { id: "pro", name: { ar: "برو", en: "Pro" }, active: true, price_stars: 250, days: 30 },
  { id: "old", name: { ar: "قديم", en: "Old" }, active: false, price_stars: 100, days: 30 },
];
const subs = new Map<string, any>();
jest.mock("@/lib/coderPlans", () => ({
  listPlans: async () => plans,
  getSubscription: async (chatId: any) => subs.get(String(chatId)) || { plan_id: "free", period_end: null },
  setSubscription: async (chatId: any, planId: string, days: number, provider: string) => { subs.set(String(chatId), { plan_id: planId, days, provider, period_end: new Date(Date.now() + days * 86400000).toISOString() }); },
}));
jest.mock("@/lib/coderAuth", () => ({ prismaDb: {}, coderChatKey: (c: any) => `k${c}` }));
import { giftPayload, parseGiftPayload, preCheckoutGift, recordGiftPayment, handleGiftUpdate, GIFT_REQ, createGiftInvoice } from "@/lib/coderGift";

function fakeDb() {
  const charges = new Set<string>();
  return { async exec() {}, async query(_s: string, id: string) { if (charges.has(id)) return []; charges.add(id); return [{ charge_id: id }]; } } as any;
}
function fakeBot() {
  const sent: any[] = [];
  const bot: any = { api: {
    sendMessage: async (chat: any, text: string, extra?: any) => { sent.push({ m: "sendMessage", chat, text, extra }); return {}; },
    answerCallbackQuery: async (id: string, extra?: any) => { sent.push({ m: "answer", id, extra }); return true; },
    sendInvoice: async (chat: any, title: string, desc: string, payload: string, currency: string, prices: any[]) => { sent.push({ m: "invoice", chat, title, payload, currency, prices }); return {}; },
  } };
  return { bot, sent };
}

describe("gift a plan with Stars", () => {
  beforeEach(() => subs.clear());
  const pro = plans[1] as any;

  it("the payload is signed and bound to giver, recipient, plan and price; self-gifts are rejected", () => {
    const p = giftPayload(1, 2, pro);
    expect(parseGiftPayload(p)).toEqual({ planId: "pro", days: 30, stars: 250, buyer: 1, recipient: 2 });
    expect(parseGiftPayload(p.replace(":2:", ":3:"))).toBeNull();
    expect(parseGiftPayload(giftPayload(1, 1, pro))).toBeNull();
  });

  it("pre-checkout: only the giver, at the current price, for a plan on sale", async () => {
    const payload = giftPayload(1, 2, pro);
    expect(await preCheckoutGift({ from: { id: 1 }, currency: "XTR", total_amount: 250, invoice_payload: payload })).toEqual({ ok: true });
    expect((await preCheckoutGift({ from: { id: 9 }, currency: "XTR", total_amount: 250, invoice_payload: payload })).ok).toBe(false);
    expect((await preCheckoutGift({ from: { id: 1 }, currency: "XTR", total_amount: 100, invoice_payload: payload })).ok).toBe(false);
    await expect(createGiftInvoice(fakeBot().bot, 1, 2, "old")).rejects.toThrow();
    await expect(createGiftInvoice(fakeBot().bot, 1, 1, "pro")).rejects.toThrow();
  });

  it("payment activates the RECIPIENT's plan once (duplicate charge ignored); the giver's plan is untouched", async () => {
    const db = fakeDb();
    const sp = { currency: "XTR", total_amount: 250, invoice_payload: giftPayload(1, 2, pro), telegram_payment_charge_id: "ch1" };
    const r = await recordGiftPayment(1, sp, db);
    expect(r?.recipient).toBe(2);
    expect(subs.get("2").plan_id).toBe("pro");
    expect(subs.get("2").provider).toBe("telegram-stars-gift");
    expect(subs.has("1")).toBe(false);
    expect((await recordGiftPayment(1, sp, db))?.duplicate).toBe(true);
    expect(await recordGiftPayment(9, sp, db)).toBeNull();
  });

  it("the bot flow: /gift -> choose user -> plan -> invoice -> both sides told", async () => {
    const { bot, sent } = fakeBot();
    const db = fakeDb();
    expect(await handleGiftUpdate(bot, { message: { chat: { id: 1, type: "private" }, from: { id: 1 }, text: "/gift" } }, db)).toBe(true);
    expect(sent[0].extra.reply_markup.keyboard[0][0].request_users.request_id).toBe(GIFT_REQ);
    await handleGiftUpdate(bot, { message: { chat: { id: 1, type: "private" }, from: { id: 1 }, users_shared: { request_id: GIFT_REQ, users: [{ user_id: 2 }] } } }, db);
    const btn = sent[1].extra.reply_markup.inline_keyboard[0][0];
    expect(btn.callback_data).toBe("gift|pro|2");
    await handleGiftUpdate(bot, { callback_query: { id: "c", from: { id: 1 }, data: btn.callback_data } }, db);
    const inv = sent.find((s) => s.m === "invoice");
    expect(inv.currency).toBe("XTR");
    expect(inv.prices[0].amount).toBe(250);
    await handleGiftUpdate(bot, { message: { chat: { id: 1 }, successful_payment: { currency: "XTR", total_amount: 250, invoice_payload: inv.payload, telegram_payment_charge_id: "ch9" } } }, db);
    expect(sent.some((s) => s.m === "sendMessage" && s.chat === 2 && /هدية/.test(s.text))).toBe(true);
    expect(sent.some((s) => s.m === "sendMessage" && s.chat === 1 && /تم إرسال الهدية/.test(s.text))).toBe(true);
    // choosing yourself is refused
    await handleGiftUpdate(bot, { message: { chat: { id: 1, type: "private" }, from: { id: 1 }, users_shared: { request_id: GIFT_REQ, users: [{ user_id: 1 }] } } }, db);
    expect(sent[sent.length - 1].text).toContain("غيرك");
    // unrelated updates are not taken
    expect(await handleGiftUpdate(bot, { message: { chat: { id: 1, type: "private" }, text: "hello" } }, db)).toBe(false);
  });
});
