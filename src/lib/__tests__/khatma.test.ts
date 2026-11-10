const db: any = { $executeRawUnsafe: jest.fn(async () => 0), $executeRaw: jest.fn(async () => 1), $queryRaw: jest.fn(async () => []), bot: { findFirst: jest.fn(async () => null) } };
jest.mock("@/lib/prisma", () => ({ prisma: db }));
import {
  JUZ_COUNT, KHATMA_CMD, MAX_OPEN_PER_USER, boardKeyboard, boardText, cleanText, completionText, emptyBoard, isComplete, isSlug, makeSlug, memorialTitle, parseJuzCallback, progress, tap,
} from "@/lib/khatma/rules";
import { handleKhatmaGroupUpdate, khatmaPreCheckout } from "@/lib/khatma/khatma";

describe("khatma rules", () => {
  it("recognises the group command in both languages and with the bot's @name", () => {
    expect(KHATMA_CMD.test("/khatma")).toBe(true);
    expect(KHATMA_CMD.exec("/khatma@MyBot ختمة رمضان")?.[4]).toBe("ختمة رمضان");
    expect(KHATMA_CMD.test("/ختمة")).toBe(true);
    expect(KHATMA_CMD.test("/khatmax")).toBe(false);
    expect(KHATMA_CMD.test("hello /khatma")).toBe(false);
  });
  it("taps: take, done, undo, busy, and a per-person limit", () => {
    const b = emptyBoard();
    expect(tap(b, 1, "u1")).toEqual({ kind: "take" });
    b[0] = { juz: 1, userId: "u1", userName: "أحمد", done: false };
    expect(tap(b, 1, "u1")).toEqual({ kind: "done" });
    expect(tap(b, 1, "u2")).toEqual({ kind: "busy", by: "أحمد" });
    b[0].done = true;
    expect(tap(b, 1, "u1")).toEqual({ kind: "undo" });
    for (let i = 1; i <= MAX_OPEN_PER_USER; i++) b[i] = { juz: i + 1, userId: "u2", userName: "س", done: false };
    expect(tap(b, 10, "u2")).toEqual({ kind: "limit" });
    expect(tap(b, 10, "u1")).toEqual({ kind: "take" });
  });
  it("tracks progress and completion", () => {
    const b = emptyBoard();
    expect(progress(b)).toEqual({ taken: 0, done: 0, free: 30 });
    expect(isComplete(b)).toBe(false);
    const full = b.map((j) => ({ ...j, userId: "u", userName: "x", done: true }));
    expect(isComplete(full)).toBe(true);
    expect(progress(full)).toEqual({ taken: 30, done: 30, free: 0 });
  });
  it("builds a 6x5 keyboard whose callbacks round-trip and fit Telegram's 64 bytes", () => {
    const kb = boardKeyboard("123456789012", 99999, emptyBoard());
    expect(kb).toHaveLength(6);
    expect(kb.every((r) => r.length === 5)).toBe(true);
    const last = kb[5][4].callback_data;
    expect(Buffer.byteLength(last)).toBeLessThanOrEqual(64);
    expect(parseJuzCallback(last)).toEqual({ khatmaId: "123456789012", round: 99999, juz: 30 });
    expect(parseJuzCallback("kj|1|1|31")).toBeNull();
    expect(parseJuzCallback("kj|1|1|0")).toBeNull();
    expect(parseJuzCallback("kj|x|1|2")).toBeNull();
    expect(JUZ_COUNT).toBe(30);
  });
  it("texts carry the title, counts, sponsor and dua", () => {
    const b = emptyBoard();
    b[4] = { juz: 5, userId: "u", userName: "منى", done: false };
    const t = boardText({ title: "ختمة العائلة", round: 2, completedRounds: 1, board: b, sponsor: "برعاية متجر" });
    expect(t).toContain("ختمة العائلة");
    expect(t).toContain("منى");
    expect(t).toContain("برعاية متجر");
    const c = completionText({ title: "ختمة العائلة", round: 2, readers: 12, sponsor: null });
    expect(c).toContain("تمّت الختمة");
    expect(c).toContain("اللهم");
  });
  it("cleans user text, builds titles and slugs", () => {
    expect(cleanText("  <b>أبي</b>\n\n محمد ", 60)).toBe("b أبي /b محمد");
    expect(memorialTitle("محمد")).toBe("ختمة عن روح محمد");
    expect(memorialTitle("سارة", "shifa")).toBe("ختمة بنية شفاء سارة");
    const s = makeSlug(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 200]));
    expect(isSlug(s)).toBe(true);
    expect(isSlug("ABC")).toBe(false);
  });
});

describe("khatma group gate", () => {
  const bot: any = { api: { sendMessage: jest.fn(async () => ({ message_id: 7 })), getMe: jest.fn(async () => ({ username: "StreakBot" })), editMessageText: jest.fn(), answerCallbackQuery: jest.fn(), getChatMember: jest.fn() } };
  const row: any = { id: "bot1", template: "STREAK_BOT" };
  beforeEach(() => jest.clearAllMocks());
  it("ignores ordinary group chatter without touching the database or replying", async () => {
    const r = await handleKhatmaGroupUpdate(bot, row, { message: { chat: { id: -100, type: "supergroup" }, from: { id: 1 }, text: "السلام عليكم" } });
    expect(r).toBe(false);
    expect(bot.api.sendMessage).not.toHaveBeenCalled();
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });
  it("ignores callbacks that aren't khatma boards", async () => {
    const r = await handleKhatmaGroupUpdate(bot, row, { callback_query: { id: "q", data: "other", from: { id: 1 }, message: { chat: { id: -100 } } } });
    expect(r).toBe(false);
  });
  it("posts a new board on /khatma", async () => {
    db.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: BigInt(5), bot_id: "bot1", chat_id: "-100", kind: "GROUP", title: "ختمة رمضان", dedication: null, round: 1, completed_rounds: 0, status: "ACTIVE" }]);
    const r = await handleKhatmaGroupUpdate(bot, row, { message: { chat: { id: -100, type: "supergroup", title: "العائلة" }, from: { id: 1 }, text: "/khatma ختمة رمضان", message_id: 3 } });
    expect(r).toBe(true);
    expect(bot.api.sendMessage).toHaveBeenCalledTimes(1);
    const [, text, opts] = bot.api.sendMessage.mock.calls[0];
    expect(text).toContain("ختمة رمضان");
    expect(opts.reply_markup.inline_keyboard).toHaveLength(6);
  });
  it("pre-checkout refuses an order that isn't the payer's or is underpaid", async () => {
    db.$queryRaw.mockResolvedValueOnce([{ user_id: "9", stars: 100, status: "PENDING", bot_id: "bot1" }]);
    expect((await khatmaPreCheckout(row, { invoice_payload: "KHATMA:4", currency: "XTR", total_amount: 100, from: { id: 8 } })).ok).toBe(false);
    db.$queryRaw.mockResolvedValueOnce([{ user_id: "9", stars: 100, status: "PENDING", bot_id: "bot1" }]);
    expect((await khatmaPreCheckout(row, { invoice_payload: "KHATMA:4", currency: "XTR", total_amount: 50, from: { id: 9 } })).ok).toBe(false);
    db.$queryRaw.mockResolvedValueOnce([{ user_id: "9", stars: 100, status: "PENDING", bot_id: "bot1" }]);
    expect((await khatmaPreCheckout(row, { invoice_payload: "KHATMA:4", currency: "XTR", total_amount: 100, from: { id: 9 } })).ok).toBe(true);
  });
});
