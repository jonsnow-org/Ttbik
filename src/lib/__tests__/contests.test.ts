const db: any = { $executeRawUnsafe: jest.fn(async () => 0), $executeRaw: jest.fn(async () => 1), $queryRaw: jest.fn(async () => []) };
jest.mock("@/lib/prisma", () => ({ prisma: db }));
import { QUESTIONS } from "@/lib/contests/questions";
import { AGAIN_DATA, CONTEST_CMD, ROUND_SIZE, TOP_CMD, resultsKeyboard, sponsorCta, parseAnswer, parseNext, pickQuestions, questionKeyboard, resultsText, scoreFor, weekStart } from "@/lib/contests/rules";
import { handleContestGroupUpdate } from "@/lib/contests/contests";

describe("contest rules", () => {
  it("has a valid question bank", () => {
    expect(QUESTIONS.length).toBeGreaterThanOrEqual(40);
    for (const q of QUESTIONS) {
      expect(q.o).toHaveLength(4);
      expect(new Set(q.o).size).toBe(4);
      expect(q.a).toBeGreaterThanOrEqual(0);
      expect(q.a).toBeLessThan(4);
    }
  });
  it("avoids recently asked questions and never repeats inside a round", () => {
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const recent = [0, 1, 2, 3, 4, 5];
    const qs = pickQuestions(recent, rand);
    expect(qs).toHaveLength(ROUND_SIZE);
    expect(new Set(qs).size).toBe(ROUND_SIZE);
    expect(qs.some((i) => recent.includes(i))).toBe(false);
  });
  it("parses its own callbacks and rejects junk", () => {
    expect(parseAnswer("cq|12|3|2")).toEqual({ roundId: "12", step: 3, choice: 2 });
    expect(parseAnswer("cq|12|3|4")).toBeNull();
    expect(parseAnswer("kj|1|1|1")).toBeNull();
    expect(parseNext("cn|99")).toBe("99");
    const kb = questionKeyboard("123456789012", 4, 0);
    for (const row of kb) for (const b of row) expect(Buffer.byteLength(b.callback_data)).toBeLessThanOrEqual(64);
  });
  it("scores and formats results; no paid entry anywhere", () => {
    expect(scoreFor(true, true)).toBe(15);
    expect(scoreFor(true, false)).toBe(10);
    expect(scoreFor(false, true)).toBe(0);
    const t = resultsText([{ name: "سارة", points: 45 }], 3, "برعاية متجر · 🎁 20$");
    expect(t).toContain("🥇 سارة: 45");
    expect(t).toContain("3");
    expect(t).toContain("برعاية متجر");
  });
  it("recognises commands and computes Monday week starts", () => {
    expect(CONTEST_CMD.test("/contest@Slaselbot")).toBe(true);
    expect(CONTEST_CMD.test("/contestx")).toBe(false);
    expect(TOP_CMD.test("/top")).toBe(true);
    expect(weekStart(new Date("2026-11-12T15:00:00Z")).toISOString()).toBe("2026-11-09T00:00:00.000Z");
    expect(weekStart(new Date("2026-11-09T00:30:00Z")).toISOString()).toBe("2026-11-09T00:00:00.000Z");
  });
});

describe("sponsorship call to action and keep-playing buttons", () => {
  it("shows the free-slot line only when no sponsor is booked, with price and days, and promises no returns", () => {
    const cta = sponsorCta(15, 7, "https://s/contests");
    expect(cta).toContain("15$");
    expect(cta).toContain("7 أيام");
    expect(cta).toContain("https://s/contests");
    expect(cta).not.toMatch(/ربح|أرباح|عائد|مضمون/);
    expect(resultsText([], null, null, cta)).toContain("مساحة إعلانية");
    const withSponsor = resultsText([], null, "برعاية متجر", cta);
    expect(withSponsor).toContain("برعاية متجر");
    expect(withSponsor).not.toContain("مساحة إعلانية");
  });
  it("offers play again, the leaderboard, adding the bot to another group, and the sponsor page", () => {
    const kb = resultsKeyboard("Slaselbot", "https://s/contests").flat() as any[];
    expect(kb.find((b) => b.callback_data === AGAIN_DATA)).toBeTruthy();
    expect(kb.find((b) => b.callback_data === "ct")).toBeTruthy();
    expect(kb.find((b) => String(b.url).includes("t.me/Slaselbot?startgroup=contest"))).toBeTruthy();
    expect(kb.find((b) => b.url === "https://s/contests")).toBeTruthy();
    for (const b of kb) if (b.callback_data) expect(Buffer.byteLength(b.callback_data)).toBeLessThanOrEqual(64);
  });
});

describe("contest group gate", () => {
  const bot: any = { api: { sendMessage: jest.fn(async () => ({ message_id: 1 })), answerCallbackQuery: jest.fn(async () => true), getMe: jest.fn(async () => ({ username: "Slaselbot" })) } };
  beforeEach(() => jest.clearAllMocks());
  it("leaves ordinary chatter and khatma taps to others, untouched", async () => {
    expect(await handleContestGroupUpdate(bot, { id: "b" } as any, { message: { chat: { id: -1, type: "group" }, from: { id: 1 }, text: "مرحبا" } })).toBe(false);
    expect(await handleContestGroupUpdate(bot, { id: "b" } as any, { callback_query: { id: "q", data: "kj|1|1|1", from: { id: 1 }, message: { chat: { id: -1 } } } })).toBe(false);
    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(bot.api.sendMessage).not.toHaveBeenCalled();
  });
  it("the play-again button does nothing outside a group (only closes the tap)", async () => {
    const r = await handleContestGroupUpdate(bot, { id: "b" } as any, { callback_query: { id: "q", data: AGAIN_DATA, from: { id: 1 }, message: { chat: { id: 5, type: "private" } } } });
    expect(r).toBe(true);
    expect(bot.api.answerCallbackQuery).toHaveBeenCalledWith("q");
    expect(bot.api.sendMessage).not.toHaveBeenCalled();
  });
});
