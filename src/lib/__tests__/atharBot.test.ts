// The Athar bot: English first for everyone, a language button, the choice remembered. Telegram and the database are stubs.
const store = new Map<string, string>();
jest.mock("@/lib/prisma", () => ({
  prisma: { atharBotUser: {
    findUnique: async ({ where }: any) => { const k = `${where.botId_tgUserId.botId}:${where.botId_tgUserId.tgUserId}`; return store.has(k) ? { lang: store.get(k) } : null; },
    upsert: async ({ where, create, update }: any) => { const w = where.botId_tgUserId; store.set(`${w.botId}:${w.tgUserId}`, update?.lang ?? create.lang); return {}; },
  } },
}));
jest.mock("@/lib/botVisit", () => ({ recordBotVisit: async () => undefined }));
import { handleAtharBotUpdate, LANGS } from "../atharBotLogic";

function fakeBot() {
  const sent: { chat: number; text: string; kb?: any }[] = [];
  return { sent, api: { sendMessage: async (chat: number, text: string, o?: any) => { sent.push({ chat, text, kb: o?.reply_markup }); }, answerCallbackQuery: async () => undefined } } as any;
}
const row = { id: "bot1" } as any;
const ARABIC = /[؀-ۿ]/;

describe("Athar bot", () => {
  beforeEach(() => store.clear());
  it("greets in English even a user whose Telegram is Arabic", async () => {
    const bot = fakeBot();
    await handleAtharBotUpdate(bot, row, { message: { chat: { id: 1 }, from: { id: 7, language_code: "ar" }, text: "/start" } });
    expect(bot.sent[0].text).toMatch(/^🕰 Welcome to Athar/);
    expect(ARABIC.test(bot.sent[0].text)).toBe(false);
    expect(JSON.stringify(bot.sent[0].kb)).toContain("lang=en");
  });
  it("has the language button and five languages", async () => {
    expect(LANGS.length).toBeGreaterThanOrEqual(5);
    const bot = fakeBot();
    await handleAtharBotUpdate(bot, row, { message: { chat: { id: 1 }, from: { id: 7 }, text: "/start" } });
    expect(JSON.stringify(bot.sent[0].kb)).toContain("al:menu");
    await handleAtharBotUpdate(bot, row, { callback_query: { id: "c", from: { id: 7 }, message: { chat: { id: 1 } }, data: "al:menu" } });
    const kb = JSON.stringify(bot.sent[bot.sent.length - 1].kb);
    for (const l of LANGS) expect(kb).toContain(`al:${l.code}`);
  });
  it("remembers the chosen language and passes it to the app", async () => {
    const bot = fakeBot();
    await handleAtharBotUpdate(bot, row, { callback_query: { id: "c", from: { id: 7 }, message: { chat: { id: 1 } }, data: "al:ru" } });
    expect(bot.sent[0].text).toMatch(/Добро пожаловать/);
    expect(JSON.stringify(bot.sent[0].kb)).toContain("lang=ru");
    const bot2 = fakeBot();
    await handleAtharBotUpdate(bot2, row, { message: { chat: { id: 1 }, from: { id: 7 }, text: "/start" } });
    expect(bot2.sent[0].text).toMatch(/Добро пожаловать/);
    const other = fakeBot();
    await handleAtharBotUpdate(other, row, { message: { chat: { id: 2 }, from: { id: 8 }, text: "/start" } });
    expect(other.sent[0].text).toMatch(/^🕰 Welcome to Athar/);
  });
  it("ignores an unknown language code", async () => {
    const bot = fakeBot();
    await handleAtharBotUpdate(bot, row, { callback_query: { id: "c", from: { id: 7 }, message: { chat: { id: 1 } }, data: "al:xx" } });
    expect(bot.sent.length).toBe(0);
  });
});
