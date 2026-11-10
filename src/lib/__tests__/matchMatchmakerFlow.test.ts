// «💍 خاطبة شخصية» end to end with the real grammy keyboards: the button is reachable from the main menu,
// the upgrades keyboard is a 2-per-row grid, and a new request reaches the admin with ready-to-send profiles.
process.env.SUPER_ADMIN_TELEGRAM_ID = "999";

const sent = new Set<string>();
const profiles: any[] = [];
const db: any = {
  matchUser: {
    upsert: jest.fn(async () => user()), findUnique: jest.fn(async () => user()), update: jest.fn(async () => ({})), create: jest.fn(async () => user()),
  },
  matchProfile: {
    findUnique: jest.fn(async ({ where }: any) => profiles.find((p) => p.userId === where.userId || p.id === where.id) ?? null),
    findMany: jest.fn(async ({ where }: any) => profiles.filter((p) => p.gender === where.gender && p.userId !== where.userId.not)),
  },
  partnerPreference: { findUnique: jest.fn(async () => ({ country: "الأردن", ageMin: 24, ageMax: 30 })) },
  matchBlock: { findMany: jest.fn(async () => []) },
  $queryRaw: jest.fn(async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const q = strings.join("?");
    if (q.includes("FROM match_matchmaker_sent")) return [...sent].filter((k) => k.startsWith(`${v[0]}:`)).map((k) => ({ profile_id: k.split(":")[1] }));
    if (q.includes("FROM match_matchmaker WHERE id")) return [{ id: BigInt(7), user_id: "123", status: "OPEN", paid: 5, note: "أبحث عن شريكة من الأردن بين 24 و30" }];
    return [];
  }),
  $executeRaw: jest.fn(async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const q = strings.join("?");
    if (q.includes("INSERT INTO match_matchmaker_sent")) {
      const k = `${v[0]}:${v[1]}`;
      if (sent.has(k)) return 0;
      sent.add(k);
      return 1;
    }
    return 1;
  }),
  $executeRawUnsafe: jest.fn(async () => 0),
  $transaction: jest.fn(),
};
function user() { return { id: "123", botId: "b1", phoneVerified: true, pendingAction: null, isBanned: false, balance: 0 }; }
jest.mock("@/lib/prisma", () => ({ prisma: db }));
jest.mock("@/lib/match/growth", () => ({ ...jest.requireActual("@/lib/match/growth"), trackFunnel: jest.fn(async () => undefined) }));

import { handleMarriageBotUpdate, upgradesMenuLabels } from "@/lib/matchBotLogic";
import { MATCHMAKER_BUTTON, CARD_BUTTON } from "@/lib/match/trustRules";
import { consumeMatchmakerNote, handleTrustCallback } from "@/lib/match/trust";

const row = { id: "b1", token: "t", ownerId: "999" } as any;
const mkBot = () => ({ api: { sendMessage: jest.fn(async () => ({ message_id: 1 })), answerCallbackQuery: jest.fn(async () => true), sendInvoice: jest.fn(async () => ({})), setMyCommands: jest.fn(async () => true), deleteMyCommands: jest.fn(async () => true), setChatMenuButton: jest.fn(async () => true), getMe: jest.fn(async () => ({ username: "Saragptbot" })) } }) as any;
const say = (text: string) => ({ message: { from: { id: 123 }, chat: { id: 123, type: "private" }, text } });
const labels = (markup: any): string[][] => (markup?.keyboard || []).map((r: any[]) => r.map((b) => (typeof b === "string" ? b : b.text)));
const female = (id: string, age: number, country: string, daysAgo: number) => ({
  id, userId: `u${id.slice(0, 4)}`, gender: "FEMALE", age, country, city: null, job: null, education: null, maritalStatus: null, attributes: null,
  status: "APPROVED", isHidden: false, verificationStatus: null, user: { botId: "b1", isBanned: false, lastActiveAt: new Date(Date.now() - daysAgo * 86400_000) },
});

beforeEach(() => { sent.clear(); profiles.length = 0; profiles.push({ ...female("00000000-0000-4000-8000-000000000123", 28, "الأردن", 0), userId: "123", gender: "MALE" }); });

describe("matchmaker is reachable", () => {
  it("/start and «back» send the main menu that carries the matchmaker and card buttons", async () => {
    const bot = mkBot();
    await handleMarriageBotUpdate(bot, row, say("/start"));
    await handleMarriageBotUpdate(bot, row, say("🔙 القائمة الرئيسية"));
    expect(bot.api.sendMessage.mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const call of bot.api.sendMessage.mock.calls) {
      const flat = labels(call[2]?.reply_markup).flat();
      expect(flat).toContain(MATCHMAKER_BUTTON);
      expect(flat).toContain(CARD_BUTTON);
    }
  });
  it("tapping the button answers with the offer and its buy button", async () => {
    const bot = mkBot();
    await handleMarriageBotUpdate(bot, row, say(MATCHMAKER_BUTTON));
    expect(bot.api.sendMessage).toHaveBeenCalledTimes(1);
    const [, text, opts] = bot.api.sendMessage.mock.calls[0];
    expect(text).toContain("الخاطبة الشخصية");
    expect(opts.reply_markup.inline_keyboard[0][0].callback_data).toBe("mm_buy");
  });
});

describe("upgrades keyboard is a grid", () => {
  it("two buttons per row, every label kept, back alone at the end", async () => {
    const bot = mkBot();
    await handleMarriageBotUpdate(bot, row, say("⭐ الترقيات والمزايا"));
    const rows = labels(bot.api.sendMessage.mock.calls[0][2].reply_markup);
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.slice(0, -1).every((r) => r.length <= 2)).toBe(true);
    expect(rows.slice(0, -2).every((r) => r.length === 2)).toBe(true);
    expect(rows[rows.length - 1]).toEqual(["🔙 القائمة الرئيسية"]);
    const flat = rows.flat();
    for (const l of upgradesMenuLabels(false)) expect(flat).toContain(l);
    expect(flat).toContain(MATCHMAKER_BUTTON);
  });
});

describe("a new request reaches the admin with ready profiles", () => {
  it("lists the best matches first, each with a one-tap suggest button, and sends one only once", async () => {
    profiles.push(female("11111111-1111-4111-8111-111111111111", 27, "الأردن", 1));   // best: country + age + active
    profiles.push(female("22222222-2222-4222-8222-222222222222", 45, "مصر", 200));     // worst
    profiles.push(female("33333333-3333-4333-8333-333333333333", 29, "الأردن", 30));
    const bot = mkBot();
    await consumeMatchmakerNote(bot, 123, "123", "7", "أبحث عن شريكة من الأردن بين 24 و30");
    const toAdmin = bot.api.sendMessage.mock.calls.filter((c: any[]) => c[0] === 999);
    const cards = toAdmin.filter((c: any[]) => String(c[2]?.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data || "").startsWith("mm_sug|"));
    expect(cards.length).toBe(3);
    expect(cards[0][2].reply_markup.inline_keyboard[0][0].callback_data).toBe("mm_sug|7|11111111-1111-4111-8111-111111111111");
    expect(cards[2][2].reply_markup.inline_keyboard[0][0].callback_data).toContain("22222222");

    const tap = { callback_query: { id: "q", data: "mm_sug|7|11111111-1111-4111-8111-111111111111", from: { id: 999 }, message: { chat: { id: 999, type: "private" } } } };
    const b2 = mkBot();
    expect(await handleTrustCallback(b2, row, tap.callback_query)).toBe(true);
    const toUser = b2.api.sendMessage.mock.calls.filter((c: any[]) => c[0] === 123);
    expect(toUser.length).toBe(1);
    expect(toUser[0][1]).toContain("اقتراح من الخاطبة");
    expect(JSON.stringify(toUser[0][2].reply_markup)).toContain("mlike|u1111");
    await handleTrustCallback(b2, row, tap.callback_query);
    expect(b2.api.sendMessage.mock.calls.filter((c: any[]) => c[0] === 123).length).toBe(1);
    expect(b2.api.answerCallbackQuery).toHaveBeenLastCalledWith("q", { text: "أُرسل هذا الملف من قبل" });
  });
  it("tells the admin clearly when nothing matches, so they can refund", async () => {
    const bot = mkBot();
    await consumeMatchmakerNote(bot, 123, "123", "7", "أبحث عن شريكة من الأردن بين 24 و30");
    const toAdmin = bot.api.sendMessage.mock.calls.filter((c: any[]) => c[0] === 999).map((c: any[]) => c[1]);
    expect(toAdmin.some((t: string) => t.includes("لا يوجد الآن أي ملف") && t.includes("استرداد"))).toBe(true);
  });
  it("only the admin can send a suggestion", async () => {
    profiles.push(female("11111111-1111-4111-8111-111111111111", 27, "الأردن", 1));
    const bot = mkBot();
    await handleTrustCallback(bot, row, { id: "q", data: "mm_sug|7|11111111-1111-4111-8111-111111111111", from: { id: 555 }, message: { chat: { id: 555 } } });
    expect(bot.api.sendMessage).not.toHaveBeenCalled();
  });
});
