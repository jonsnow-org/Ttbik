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
  checkInCore: (...a: unknown[]) => (checkIn as any)(...a),
  ensureStreakUser: (...a: unknown[]) => (db.streakUser.upsert as any)(...a),
}));
import { replyEphemeral } from "@/lib/telegramEphemeral";
import { handleStreakWidgetQuery, sendStreakWidget, widgetHtml, widgetState } from "@/lib/streakWidget";
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
    expect(await sendStreakWidget(bot, 55, "7")).toBe(true);
    expect(calls[0].method).toBe("sendWidget");
    expect(calls[0].p).toMatchObject({ chat_id: 55, allow_queries: true });
    expect(JSON.parse(calls[0].p.chat_data)).toHaveProperty("fasting");
  });
  it("falls back to a plain list when sendWidget is refused", async () => {
    const { bot, api } = fakeBot(async () => { throw new Error("nope"); });
    expect(await sendStreakWidget(bot, 55, "7")).toBe(false);
    expect(api.sendMessage).toHaveBeenCalled();
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
