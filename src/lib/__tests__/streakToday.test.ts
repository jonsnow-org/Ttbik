process.env.SUPER_ADMIN_TELEGRAM_ID = "9001";
const store: Record<string, unknown> = {};
jest.mock("@/lib/supabase", () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({ eq: (_c: string, k: string) => ({ maybeSingle: async () => ({ data: k in store ? { value: store[k] } : null }) }) }),
      upsert: async (row: { key: string; value: unknown }) => { store[row.key] = row.value; return {}; },
    }),
  }),
}));
const entry = { currentStreak: 3 };
jest.mock("@/lib/prisma", () => ({ prisma: { streakEntry: { findUnique: jest.fn(async () => entry) } } }));
const checkIn = jest.fn(async () => ({ already: false, continued: true, entry: { currentStreak: 4 } }));
jest.mock("@/lib/streakBotLogic", () => ({ checkInCore: (...a: unknown[]) => (checkIn as any)(...a), ensureStreakUser: jest.fn(async () => ({ isBanned: false })) }));
import { QUESTIONS } from "@/lib/contests/questions";
import { PRAYER_CITIES } from "@/lib/prayerCities";
import { COUNTRIES, citiesKeyboard, countdownLabel, countryKeyboard, handleTodayCallback, questionIndexForDay, todayView } from "@/lib/streakToday";

const NOW = new Date("2026-11-14T10:00:00Z");
const dayOf = (d: Date) => Math.floor(d.getTime() / 86_400_000);
const damascus = PRAYER_CITIES.find((c) => c.slug === "damascus")!;

describe("today card", () => {
  it("walks the whole question bank before repeating a question", () => {
    const seen = new Set<number>();
    for (let d = 20000; d < 20000 + QUESTIONS.length; d++) seen.add(questionIndexForDay(d));
    expect(seen.size).toBe(QUESTIONS.length);
    expect(questionIndexForDay(20000)).toBe(questionIndexForDay(20000));
  });
  it("formats the countdown", () => {
    expect(countdownLabel(90 * 60_000)).toBe("1 س 30 د");
    expect(countdownLabel(5 * 60_000)).toBe("5 د");
    expect(countdownLabel(-1)).toBe("0 د");
  });
  it("without a city: dates and the question, a prompt to choose a city, four answers and the city button", () => {
    const v = todayView({ now: NOW, city: null, attempt: null, quizStreak: 0 });
    expect(v.text).toContain("بطاقة اليوم");
    expect(v.text).toContain("اختر مدينتك");
    expect(v.text).not.toContain("مواقيت الصلاة —");
    const btns = v.keyboard.inline_keyboard.flat() as any[];
    expect(btns.filter((b) => String(b.callback_data).startsWith("tq|"))).toHaveLength(4);
    expect(btns.some((b) => b.callback_data === "tcc")).toBe(true);
    for (const b of btns) expect(Buffer.byteLength(b.callback_data)).toBeLessThanOrEqual(64);
  });
  it("with a city: the six prayer times and the next one", () => {
    const v = todayView({ now: NOW, city: damascus, attempt: null, quizStreak: 0 });
    expect(v.text).toContain("مواقيت الصلاة — دمشق");
    for (const n of ["الفجر", "الشروق", "الظهر", "العصر", "المغرب", "العشاء"]) expect(v.text).toContain(n);
    expect(v.text).toContain("القادمة");
    expect(v.text).toContain("👉");
  });
  it("after an attempt: no answer buttons; right shows the streak, wrong shows the correct answer", () => {
    const q = QUESTIONS[questionIndexForDay(dayOf(NOW))];
    const right = todayView({ now: NOW, city: null, attempt: { day: dayOf(NOW), choice: q.a }, quizStreak: 4 });
    expect(right.text).toContain("صحيح");
    expect(right.text).toContain("4");
    expect((right.keyboard.inline_keyboard.flat() as any[]).some((b) => String(b.callback_data).startsWith("tq|"))).toBe(false);
    const wrong = todayView({ now: NOW, city: null, attempt: { day: dayOf(NOW), choice: (q.a + 1) % 4 }, quizStreak: 0 });
    expect(wrong.text).toContain(q.o[q.a]);
    expect(wrong.text).toContain("❌");
  });
  it("country and city pickers fit the callback limit and cover every city", () => {
    const all: string[] = [];
    COUNTRIES.forEach((_c, i) => {
      for (const b of (citiesKeyboard(i).inline_keyboard.flat() as any[])) { expect(Buffer.byteLength(b.callback_data)).toBeLessThanOrEqual(64); if (b.callback_data.startsWith("tcp|")) all.push(b.callback_data.slice(4)); }
    });
    expect(all.sort()).toEqual(PRAYER_CITIES.map((c) => c.slug).sort());
    for (const b of (countryKeyboard().inline_keyboard.flat() as any[])) expect(Buffer.byteLength(b.callback_data)).toBeLessThanOrEqual(64);
  });
});

describe("today card callbacks", () => {
  const mkBot = () => ({ api: { answerCallbackQuery: jest.fn(async () => true), editMessageText: jest.fn(async () => true) } }) as any;
  const cq = (data: string, uid = 7) => ({ id: "c1", data, from: { id: uid }, message: { chat: { id: 55 }, message_id: 9 } });
  beforeEach(() => { for (const k of Object.keys(store)) delete store[k]; checkIn.mockClear(); jest.useFakeTimers().setSystemTime(NOW); });
  afterEach(() => jest.useRealTimers());

  it("ignores other callbacks", async () => {
    expect(await handleTodayCallback(mkBot(), { id: "b" } as any, cq("sk|fasting"))).toBe(false);
    expect(await handleTodayCallback(mkBot(), { id: "b" } as any, cq("cq|1|1|1"))).toBe(false);
  });
  it("saves the picked city and redraws with its prayer times", async () => {
    const bot = mkBot();
    expect(await handleTodayCallback(bot, { id: "b" } as any, cq("tcp|damascus"))).toBe(true);
    expect(store["streak_city:7"]).toBe("damascus");
    expect(bot.api.editMessageText).toHaveBeenCalledWith(55, 9, expect.stringContaining("مواقيت الصلاة — دمشق"), expect.anything());
  });
  it("a right answer is the day's check-in of the quiz chain; one attempt a day", async () => {
    const day = dayOf(NOW), q = QUESTIONS[questionIndexForDay(day)];
    const bot = mkBot();
    await handleTodayCallback(bot, { id: "b" } as any, cq(`tq|${day}|${q.a}`));
    expect(checkIn).toHaveBeenCalledWith("b", "7", "quiz");
    expect(store["streak_tq:7"]).toEqual({ day, choice: q.a });
    checkIn.mockClear();
    await handleTodayCallback(bot, { id: "b" } as any, cq(`tq|${day}|${(q.a + 1) % 4}`));
    expect(checkIn).not.toHaveBeenCalled();
    expect(bot.api.answerCallbackQuery).toHaveBeenLastCalledWith("c1", { text: "أجبت على سؤال اليوم بالفعل.", show_alert: false });
  });
  it("a wrong answer does not check in and shows the right one; yesterday's question is refused", async () => {
    const day = dayOf(NOW), q = QUESTIONS[questionIndexForDay(day)];
    const bot = mkBot();
    await handleTodayCallback(bot, { id: "b" } as any, cq(`tq|${day}|${(q.a + 1) % 4}`, 8));
    expect(checkIn).not.toHaveBeenCalled();
    expect(bot.api.answerCallbackQuery).toHaveBeenCalledWith("c1", { text: `❌ الصحيح: ${q.o[q.a]}`, show_alert: true });
    await handleTodayCallback(bot, { id: "b" } as any, cq(`tq|${day - 1}|${q.a}`, 9));
    expect(checkIn).not.toHaveBeenCalled();
    expect(store["streak_tq:9"]).toBeUndefined();
  });
});
