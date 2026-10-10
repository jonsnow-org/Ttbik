// The Athar bot: English first for everyone, a language button, the choice remembered. Telegram and the database are stubs.
const store = new Map<string, string>();
const channelSet: (string | null)[] = [];
const members = new Set<number>();
const raw: unknown[][] = [];
jest.mock("@/lib/prisma", () => ({
  prisma: { atharBotUser: {
    findUnique: async ({ where }: any) => { const k = `${where.botId_tgUserId.botId}:${where.botId_tgUserId.tgUserId}`; return store.has(k) ? { lang: store.get(k) } : null; },
    upsert: async ({ where, create, update }: any) => { const w = where.botId_tgUserId; store.set(`${w.botId}:${w.tgUserId}`, update?.lang ?? create.lang); return {}; },
  }, $executeRawUnsafe: async (...a: unknown[]) => { raw.push(a); return 1; }, bot: { update: async ({ data }: any) => { channelSet.push(data.requiredChannel); return {}; } } },
}));
jest.mock("@/lib/botVisit", () => ({ recordBotVisit: async () => undefined }));
import { handleAtharBotUpdate, LANGS, COMMANDS } from "../atharBotLogic";

function fakeBot() {
  const sent: { chat: number; text: string; kb?: any }[] = [];
  const calls: string[] = [];
  return { sent, calls, api: { sendMessage: async (chat: number, text: string, o?: any) => { sent.push({ chat, text, kb: o?.reply_markup }); return { message_id: 1 }; }, answerCallbackQuery: async () => undefined, setMyCommands: async (c: any) => { calls.push("commands:" + c.map((x: any) => x.command).join(",")); }, setChatMenuButton: async (o: any) => { calls.push("menu:" + o.menu_button.web_app.url); }, deleteMessage: async () => undefined, getChat: async () => ({ id: 1 }), getChatMember: async (_c: string, u: number) => { if (!members.has(u)) throw new Error("not a member"); return { status: "member" }; } } } as any;
}
const row = { id: "bot1", ownerId: "555001" } as any;
const ARABIC = /[؀-ۿ]/;

describe("Athar bot", () => {
  beforeEach(() => { store.clear(); channelSet.length = 0; members.clear(); });
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
    expect(JSON.stringify(bot.sent[0].kb)).toContain("🌐 Language");
    await handleAtharBotUpdate(bot, row, { message: { chat: { id: 1 }, from: { id: 7 }, text: "🌐 Language" } });
    const kb = JSON.stringify(bot.sent[bot.sent.length - 1].kb);
    for (const l of LANGS) expect(kb).toContain(l.name);
    await handleAtharBotUpdate(bot, row, { message: { chat: { id: 1 }, from: { id: 7 }, text: "Русский" } });
    expect(bot.sent[bot.sent.length - 1].text).toMatch(/Добро пожаловать/);
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

  it("the owner gets a Stats button, nobody else does", async () => {
    const owner = fakeBot();
    await handleAtharBotUpdate(owner, row, { message: { chat: { id: 1 }, from: { id: 555001 }, text: "/start" } });
    expect(JSON.stringify(owner.sent[0].kb)).toContain("📊 Stats");
    const user = fakeBot();
    await handleAtharBotUpdate(user, row, { message: { chat: { id: 2 }, from: { id: 9 }, text: "/start" } });
    expect(JSON.stringify(user.sent[0].kb)).not.toContain("📊 Stats");
    expect(JSON.stringify(user.sent[0].kb)).not.toContain("الاشتراك الإجباري");
    const typed = fakeBot();
    await handleAtharBotUpdate(typed, row, { message: { chat: { id: 2 }, from: { id: 9 }, text: "📊 Stats" } });
    expect(typed.sent[0].text).not.toMatch(/Athar bot/);
    const sneaky = fakeBot();
    await handleAtharBotUpdate(sneaky, row, { callback_query: { id: "c", from: { id: 9 }, message: { chat: { id: 2 } }, data: "ao:stats" } });
    expect(sneaky.sent.length).toBe(0);
    const ask = fakeBot();
    await handleAtharBotUpdate(ask, row, { callback_query: { id: "c", from: { id: 555001 }, message: { chat: { id: 1 } }, data: "ao:stats" } });
    expect(ask.sent.length).toBe(1);
  });

  it("keeps the chat tidy and puts the sections in the bot's menu", async () => {
    const bot = fakeBot();
    await handleAtharBotUpdate(bot, row, { message: { chat: { id: 3 }, from: { id: 11 }, text: "/start" } });
    const kb = JSON.stringify(bot.sent[0].kb);
    expect(kb).toContain('"keyboard"');                // a menu panel under the message box, not inline buttons in the chat
    expect(kb).not.toContain("inline_keyboard");
    expect(kb).toContain("/mystery?lang=en");          // its buttons open the sections directly
    expect(COMMANDS.map((c) => c.command).join(",")).toBe("start,open,mystery,auctions,mine,board,birthday,language");   // set once per server start
    expect(bot.calls.some((c: string) => c.includes("menu:") && c.includes("lang=en"))).toBe(true);
    const sec = fakeBot();
    await handleAtharBotUpdate(sec, row, { message: { chat: { id: 3 }, from: { id: 11 }, text: "/mystery" } });
    expect(sec.sent[0].text).toBe("🎁 Mystery boxes");
    expect(JSON.stringify(sec.sent[0].kb)).toContain("/mystery?lang=en");
    const old = fakeBot();
    await handleAtharBotUpdate(old, row, { message: { chat: { id: 3 }, from: { id: 11 }, text: "🕰 Athar" } });
    expect(JSON.stringify(old.sent[0].kb)).toContain("lang=en");
  });

  it("the menu panel is the same shape for the owner and the user, the owner has two more buttons", async () => {
    const o = fakeBot(), u = fakeBot();
    await handleAtharBotUpdate(o, row, { message: { chat: { id: 1 }, from: { id: 555001 }, text: "/start" } });
    await handleAtharBotUpdate(u, row, { message: { chat: { id: 2 }, from: { id: 9 }, text: "/start" } });
    expect(JSON.stringify(o.sent[0].kb)).toContain("الاشتراك الإجباري");
    expect(o.sent[0].kb.keyboard.length).toBeGreaterThan(u.sent[0].kb.keyboard.length);
    expect(o.sent[0].kb.is_persistent).toBe(true);
  });

  it("the owner adds a mandatory channel; members pass, others are held until they join", async () => {
    const o = fakeBot();
    await handleAtharBotUpdate(o, row, { message: { chat: { id: 1 }, from: { id: 555001 }, text: "📢 قناة الاشتراك الإجباري" } });
    expect(o.sent[0].kb.force_reply).toBe(true);
    const ask = o.sent[0].text;
    await handleAtharBotUpdate(o, row, { message: { chat: { id: 1 }, from: { id: 555001 }, text: "https://t.me/AtharChannel", reply_to_message: { text: ask } } });
    expect(channelSet).toEqual(["AtharChannel"]);
    expect(o.sent[1].text).toMatch(/فُعّل الاشتراك الإجباري في @AtharChannel/);
    // a stranger's reply to the same question changes nothing
    await handleAtharBotUpdate(fakeBot(), row, { message: { chat: { id: 2 }, from: { id: 9 }, text: "@Evil", reply_to_message: { text: ask } } });
    expect(channelSet).toEqual(["AtharChannel"]);
    const gated = { ...row, requiredChannel: "AtharChannel" };
    const out = fakeBot();
    await handleAtharBotUpdate(out, gated, { message: { chat: { id: 2 }, from: { id: 9 }, text: "/start" } });
    expect(out.sent[0].text).toContain("https://t.me/AtharChannel");
    expect(out.sent[0].text).not.toMatch(/Welcome to Athar/);
    members.add(9);
    await handleAtharBotUpdate(out, gated, { message: { chat: { id: 2 }, from: { id: 9 }, text: "✅ I joined" } });
    expect(out.sent[1].text).toMatch(/^🕰 Welcome to Athar/);
    const ownerIn = fakeBot();
    await handleAtharBotUpdate(ownerIn, gated, { message: { chat: { id: 1 }, from: { id: 555001 }, text: "/start" } });
    expect(ownerIn.sent[0].text).toMatch(/^🕰 Welcome to Athar/);
    // turning it off
    await handleAtharBotUpdate(o, gated, { message: { chat: { id: 1 }, from: { id: 555001 }, text: "إلغاء", reply_to_message: { text: ask } } });
    expect(channelSet[channelSet.length - 1]).toBeNull();
  });
});

describe("Athar bot birthday reminder", () => {
  beforeEach(() => { store.clear(); raw.length = 0; });
  it("has the button, asks for the date and saves the answer", async () => {
    const bot = fakeBot();
    await handleAtharBotUpdate(bot, row, { message: { chat: { id: 1 }, from: { id: 7 }, text: "/start" } });
    expect(JSON.stringify(bot.sent[0].kb)).toContain("🎂 Birthday reminder");
    await handleAtharBotUpdate(bot, row, { message: { chat: { id: 1 }, from: { id: 7 }, text: "🎂 Birthday reminder" } });
    const ask = bot.sent[bot.sent.length - 1];
    expect(ask.text).toMatch(/birthday/i);
    await handleAtharBotUpdate(bot, row, { message: { chat: { id: 1 }, from: { id: 7 }, text: "14/3/2003", reply_to_message: { text: ask.text } } });
    expect(bot.sent[bot.sent.length - 1].text).toMatch(/Saved: 14\/3\/2003/);
    expect(raw[0].slice(1)).toEqual(["bot1", "7", "en", 3, 14, 2003]);
  });
  it("takes /birthday with the date, removes it with off, refuses a bad date", async () => {
    const bot = fakeBot();
    await handleAtharBotUpdate(bot, row, { message: { chat: { id: 1 }, from: { id: 7 }, text: "/birthday ١٤/٣" } });
    expect(bot.sent[bot.sent.length - 1].text).toMatch(/Saved: 14\/3 \(without a year\)/);
    await handleAtharBotUpdate(bot, row, { message: { chat: { id: 1 }, from: { id: 7 }, text: "/birthday off" } });
    expect(raw[1].slice(4)).toEqual([null, null, null]);
    await handleAtharBotUpdate(bot, row, { message: { chat: { id: 1 }, from: { id: 7 }, text: "/birthday 31/2/2003" } });
    expect(bot.sent[bot.sent.length - 1].text).toMatch(/could not read/);
    expect(raw.length).toBe(2);
  });
});
