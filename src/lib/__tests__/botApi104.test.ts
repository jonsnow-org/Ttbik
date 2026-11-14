const db: any = {
  streakEntry: { findMany: jest.fn(async () => []) },
  streakUser: { upsert: jest.fn(async () => ({ isBanned: false, mutedUntil: null })) },
};
jest.mock("@/lib/prisma", () => ({ prisma: db }));
const checkIn = jest.fn(async () => ({ already: false, continued: false, entry: {} }));
jest.mock("@/lib/streakBotLogic", () => ({
  STREAK_CATEGORIES: [
    { id: "fasting", emoji: "🌙", title: "الصيام", menuLabel: "x" },
    { id: "prayer", emoji: "🕌", title: "الصلاة", menuLabel: "y" },
  ],
  todayKey: () => "2026-11-14",
  yesterdayKey: () => "2026-11-13",
  checkInCore: (...a: unknown[]) => (checkIn as any)(...a),
  ensureStreakUser: (...a: unknown[]) => (db.streakUser.upsert as any)(...a),
}));
import { replyEphemeral } from "@/lib/telegramEphemeral";
import { boardKeyboard, boardText, handleBoardTap, handleStreakWidgetQuery, sendStreakWidget, shownStreak, widgetHtml, widgetState } from "@/lib/streakWidget";
import { minePointsText, parseMine, questionKeyboard } from "@/lib/contests/rules";
import { gzipSync } from "zlib";

function fakeBot(rawImpl: (method: string, p: any) => Promise<unknown> = async () => true) {
  const calls: { method: string; p: any }[] = [];
  const raw = new Proxy({}, { get: (_t, method: string) => async (p: any) => { calls.push({ method, p }); return rawImpl(method, p); } });
  const api = { raw, answerCallbackQuery: jest.fn(async () => true), sendMessage: jest.fn(async () => ({})) };
  return { bot: { api } as any, calls, api };
}

describe("ephemeral replies (Bot API 10.4)", () => {
  it("sends sendMessage with callback_query_id and no chat_id, then closes the tap", async () => {
    const { bot, calls, api } = fakeBot();
    expect(await replyEphemeral(bot, "cb1", "سرّي")).toBe("ephemeral");
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("sendMessage");
    expect(calls[0].p).toEqual({ ephemeral_message_parameters: { callback_query_id: "cb1" }, text: "سرّي" });
    expect(calls[0].p.chat_id).toBeUndefined();
    expect(api.answerCallbackQuery).toHaveBeenCalledWith("cb1");
  });
  it("falls back to an alert popup when Telegram refuses it, so the text is never lost", async () => {
    const { bot, api } = fakeBot(async () => { throw new Error("Bad Request"); });
    expect(await replyEphemeral(bot, "cb2", "نقاطك 10")).toBe("popup");
    expect(api.answerCallbackQuery).toHaveBeenCalledWith("cb2", { text: "نقاطك 10", show_alert: true });
  });
  it("the contest question has a «نقاطي» button with a valid short callback", () => {
    const flat = questionKeyboard("123456789012", 1, 0).flat();
    const mine = flat.find((b) => b.callback_data.startsWith("cm|"));
    expect(mine?.text).toContain("نقاطي");
    expect(parseMine(mine!.callback_data)).toBe("123456789012");
    expect(Buffer.byteLength(mine!.callback_data)).toBeLessThanOrEqual(64);
    expect(parseMine("cq|1|1|1")).toBeNull();
    expect(minePointsText(0, 0, 0, 0)).toContain("لم تجب");
    expect(minePointsText(25, 2, 2, 1)).toContain("25");
  });
});

describe("streak widget (Bot API 10.4)", () => {
  it("fits the widget limits: html ≤ 32768 bytes, ≤ 4096 compressed, state ≤ 1024 bytes", () => {
    const html = widgetHtml();
    expect(Buffer.byteLength(html)).toBeLessThanOrEqual(32768);
    expect(gzipSync(html, { level: 9 }).length).toBeLessThanOrEqual(4096);
    const state = widgetState([{ category: "fasting", currentStreak: 999, lastCheckInDate: "2026-11-14" }]);
    expect(Buffer.byteLength(state)).toBeLessThanOrEqual(1024);
    expect(JSON.parse(state).fasting).toEqual([999, Math.floor(Date.parse("2026-11-14") / 86_400_000)]);
    expect(JSON.parse(state).prayer).toEqual([0, -9]);
    expect(html).not.toMatch(/fetch\(|XMLHttpRequest|alert\(|window\.open/); // the widget runtime has no network and these throw
    expect(html).toContain("window.TelegramWidget");
    expect(html).toContain("W.request(");
  });
  it("sends the widget in the chat with queries allowed and the state as chat_data", async () => {
    const { bot, calls } = fakeBot();
    expect(await sendStreakWidget(bot, 55, "7")).toBeNull();
    expect(calls[0].method).toBe("sendWidget");
    expect(calls[0].p).toMatchObject({ chat_id: 55, allow_queries: true });
    expect(JSON.parse(calls[0].p.chat_data)).toHaveProperty("fasting");
  });
  it("returns Telegram's own refusal text when sendWidget is refused (shown to the owner only)", async () => {
    const { bot } = fakeBot(async () => { throw Object.assign(new Error("x"), { description: "Bad Request: method not found" }); });
    expect(await sendStreakWidget(bot, 55, "7")).toBe("Bad Request: method not found");
  });
  it("a tap records the check-in with the same core as the chat, then answers inside the 15 s window and refreshes the message", async () => {
    checkIn.mockClear();
    const { bot, calls } = fakeBot();
    await handleStreakWidgetQuery(bot, { id: "bot1" } as any, { id: "q1", from: { id: 7 }, data: "ci:fasting", chat: { id: 55 }, message_id: 9 });
    expect(checkIn).toHaveBeenCalledWith("bot1", "7", "fasting");
    const ans = calls.find((c) => c.method === "answerWidgetQuery")!;
    expect(ans.p.widget_query_id).toBe("q1");
    expect(JSON.parse(ans.p.data)).toHaveProperty("fasting");
    expect(calls.find((c) => c.method === "editMessageWidgetData")!.p).toMatchObject({ chat_id: 55, message_id: 9 });
  });
  it("junk, unknown categories and banned users never check in, but are still answered", async () => {
    checkIn.mockClear();
    const { bot, calls } = fakeBot();
    await handleStreakWidgetQuery(bot, { id: "b" } as any, { id: "q2", from: { id: 7 }, data: "ci:../x" });
    await handleStreakWidgetQuery(bot, { id: "b" } as any, { id: "q3", from: { id: 7 }, data: "ci:zzzz" });
    db.streakUser.upsert.mockResolvedValueOnce({ isBanned: true, mutedUntil: null });
    await handleStreakWidgetQuery(bot, { id: "b" } as any, { id: "q4", from: { id: 8 }, data: "ci:fasting" });
    expect(checkIn).not.toHaveBeenCalled();
    expect(calls.filter((c) => c.method === "answerWidgetQuery").map((c) => c.p.widget_query_id)).toEqual(["q2", "q3", "q4"]);
  });
});

describe("streak board (inline buttons, works everywhere)", () => {
  const E = (category: string, currentStreak: number, lastCheckInDate: string | null) => ({ category, currentStreak, lastCheckInDate });
  it("a chain that missed yesterday and today shows 0; yesterday or today keeps its number", () => {
    expect(shownStreak(E("fasting", 5, "2026-11-14"), "2026-11-14", "2026-11-13")).toBe(5);
    expect(shownStreak(E("fasting", 5, "2026-11-13"), "2026-11-14", "2026-11-13")).toBe(5);
    expect(shownStreak(E("fasting", 5, "2026-11-10"), "2026-11-14", "2026-11-13")).toBe(0);
    expect(shownStreak(undefined, "2026-11-14", "2026-11-13")).toBe(0);
  });
  it("draws one button per chain with the done state, callbacks within 64 bytes", () => {
    const entries = [E("fasting", 3, "2026-11-14")];
    expect(boardText(entries, "2026-11-14", "2026-11-13")).toContain("🌙 الصيام — 🔥 3 يوم  ✅ سجّلت اليوم");
    const btns = boardKeyboard(entries, "2026-11-14").inline_keyboard.flat();
    expect(btns).toHaveLength(2);
    expect((btns[0] as any).text).toContain("✅");
    expect((btns[1] as any).text).toContain("سجّل");
    for (const b of btns) expect(Buffer.byteLength((b as any).callback_data)).toBeLessThanOrEqual(64);
  });
  it("a tap checks in, toasts the new streak and redraws the board in place", async () => {
    checkIn.mockClear();
    checkIn.mockResolvedValueOnce({ already: false, continued: true, entry: { currentStreak: 4 } } as any);
    const api = { answerCallbackQuery: jest.fn(async () => true), editMessageText: jest.fn(async () => true) };
    const ok = await handleBoardTap({ api } as any, { id: "bot1" } as any, { id: "c1", data: "sk|fasting", from: { id: 7 }, message: { chat: { id: 55 }, message_id: 9 } });
    expect(ok).toBe(true);
    expect(checkIn).toHaveBeenCalledWith("bot1", "7", "fasting");
    expect(api.answerCallbackQuery).toHaveBeenCalledWith("c1", { text: expect.stringContaining("4") });
    expect(api.editMessageText).toHaveBeenCalledWith(55, 9, expect.stringContaining("لوحة سلاسلك"), expect.anything());
  });
  it("unknown categories and other callbacks never check in", async () => {
    checkIn.mockClear();
    const api = { answerCallbackQuery: jest.fn(async () => true), editMessageText: jest.fn() };
    expect(await handleBoardTap({ api } as any, { id: "b" } as any, { id: "c", data: "sk|zzz", from: { id: 7 } })).toBe(true);
    expect(await handleBoardTap({ api } as any, { id: "b" } as any, { id: "c", data: "cq|1|1|1", from: { id: 7 } })).toBe(false);
    expect(checkIn).not.toHaveBeenCalled();
  });
});
