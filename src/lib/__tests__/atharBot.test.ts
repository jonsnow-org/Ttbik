// The Athar bot: English first for everyone, a language button, the choice remembered. Telegram and the database are stubs.
const store = new Map<string, string>();
const channelSet: (string | null)[] = [];
const members = new Set<number>();
const raw: unknown[][] = [];
jest.mock("@/lib/prisma", () => ({
  prisma: { atharBotUser: {
    findUnique: async ({ where }: any) => { const k = `${where.botId_tgUserId.botId}:${where.botId_tgUserId.tgUserId}`; return store.has(k) ? { lang: store.get(k) } : null; },
    upsert: async ({ where, create, update }: any) => { const w = where.botId_tgUserId; store.set(`${w.botId}:${w.tgUserId}`, update?.lang ?? create.lang); return {}; },
  }, $executeRawUnsafe: async (...a: unknown[]) => { raw.push(a); return 1; }, bot: { update: async ({ data }: any) => { channelSet.push(data.requiredChannel); return {}; }, findFirst: async () => null } },
}));
jest.mock("@/lib/botVisit", () => ({ recordBotVisit: async () => undefined }));
// the chain and its stored state are stubs: nothing here touches the network or the database
const watch = { alerts: true, baselineAt: "x" as string, days: {} as Record<string, { n: number; nano: string }>, lastLt: "1", total: 0 };
jest.mock("@/lib/atharWatch", () => {
  const real = jest.requireActual("@/lib/atharWatch");
  return {
    ...real,
    fetchBalance: async () => BigInt(3_500_000_000),
    fetchIncoming: async () => [{ hash: "abc", lt: "5", at: Date.now(), from: "0:EF9E00000000", nano: BigInt(218_000_000) }],
    loadWatch: async () => watch,
    setAlerts: async (on: boolean) => { watch.alerts = on; },
    checkPayments: async () => ({ ok: true, fresh: [{ hash: "h1", lt: "9", at: Date.now(), from: "0:AA", nano: BigInt(99_000_000) }], balance: BigInt(3_600_000_000) }),
  };
});
import { handleAtharBotUpdate, LANGS, COMMANDS } from "../atharBotLogic";

function fakeBot() {
  const sent: { chat: number; text: string; kb?: any }[] = [];
  const calls: string[] = [];
  return { sent, calls, api: { sendMessage: async (chat: number, text: string, o?: any) => { sent.push({ chat, text, kb: o?.reply_markup }); return { message_id: 1 }; }, answerCallbackQuery: async () => undefined, setMyCommands: async (c: any) => { calls.push("commands:" + c.map((x: any) => x.command).join(",")); }, setChatMenuButton: async (o: any) => { calls.push("menu:" + o.menu_button.web_app.url); }, deleteMessage: async () => undefined, getMe: async () => ({ username: "AtharDaysBot" }), getChat: async () => ({ id: 1 }), getChatMember: async (_c: string, u: number) => { if (!members.has(u)) throw new Error("not a member"); return { status: "member" }; } } } as any;
}
const row = { id: "bot1", ownerId: "555001" } as any;
const ARABIC = /[؀-ۿ]/;

describe("Athar bot", () => {
  it("the owner sees a different panel: balance, payments, alerts, stats, channel, user view", async () => {
    const owner = fakeBot();
    await handleAtharBotUpdate(owner, row, { message: { chat: { id: 1 }, from: { id: 555001 }, text: "/start" } });
    const kb = JSON.stringify(owner.sent[0].kb);
    for (const b of ["💰 الرصيد", "📈 آخر الدفعات", "📊 Stats", "🔔 التنبيهات", "🔄 افحص الآن", "👁 شكل المستخدم"]) expect(kb).toContain(b);
    expect(kb).not.toContain("🌐 Language");
    expect(kb).not.toContain("Mystery boxes");
    expect(owner.sent[0].text).toContain("لوحة أدمن أثر");
    expect(owner.sent[0].text).toContain("3.50 TON");
    const user = fakeBot();
    await handleAtharBotUpdate(user, row, { message: { chat: { id: 2 }, from: { id: 9 }, text: "/start" } });
    const ukb = JSON.stringify(user.sent[0].kb);
    for (const b of ["💰 الرصيد", "🔔 التنبيهات", "👁 شكل المستخدم", "🛠 لوحة الأدمن"]) expect(ukb).not.toContain(b);
  });
  it("balance, payments, alerts and the manual check work for the owner only", async () => {
    const o = fakeBot();
    await handleAtharBotUpdate(o, row, { message: { chat: { id: 1 }, from: { id: 555001 }, text: "💰 الرصيد" } });
    expect(o.sent[0].text).toContain("3.50 TON");
    await handleAtharBotUpdate(o, row, { message: { chat: { id: 1 }, from: { id: 555001 }, text: "📈 آخر الدفعات" } });
    expect(o.sent[1].text).toContain("+0.218 TON");
    await handleAtharBotUpdate(o, row, { message: { chat: { id: 1 }, from: { id: 555001 }, text: "🔔 التنبيهات" } });
    expect(o.sent[2].text).toContain("متوقفة");
    expect(watch.alerts).toBe(false);
    await handleAtharBotUpdate(o, row, { message: { chat: { id: 1 }, from: { id: 555001 }, text: "🔔 التنبيهات" } });
    expect(watch.alerts).toBe(true);
    await handleAtharBotUpdate(o, row, { message: { chat: { id: 1 }, from: { id: 555001 }, text: "🔄 افحص الآن" } });
    expect(o.sent[4].text).toContain("دفعة جديدة");
    const stranger = fakeBot();
    for (const t of ["💰 الرصيد", "📈 آخر الدفعات", "🔔 التنبيهات", "🔄 افحص الآن", "👁 شكل المستخدم", "/admin"]) {
      await handleAtharBotUpdate(stranger, row, { message: { chat: { id: 2 }, from: { id: 9 }, text: t } });
    }
    expect(stranger.sent.every((m) => !m.text.includes("TON") && !m.text.includes("لوحة"))).toBe(true);
  });
  it("the owner can preview the user menu and come back", async () => {
    const o = fakeBot();
    await handleAtharBotUpdate(o, row, { message: { chat: { id: 1 }, from: { id: 555001 }, text: "👁 شكل المستخدم" } });
    const kb = JSON.stringify(o.sent[0].kb);
    expect(kb).toContain("Open Athar");
    expect(kb).toContain("🛠 لوحة الأدمن");
    await handleAtharBotUpdate(o, row, { message: { chat: { id: 1 }, from: { id: 555001 }, text: "🛠 لوحة الأدمن" } });
    expect(JSON.stringify(o.sent[1].kb)).toContain("💰 الرصيد");
  });

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
    expect(kb).toContain("/today?lang=en");            // its buttons open the app directly, one per different thing (no duplicate section buttons)
    expect(kb).toContain("Share Athar");
    expect(kb).not.toContain("/mystery?lang=en");
    expect(bot.sent[0].kb.is_persistent).toBeFalsy();  // collapsible with the phone's Back button
    expect(COMMANDS.map((c) => c.command).join(",")).toBe("start,open,mystery,auctions,mine,board,share,match,birthday,language");   // set once per server start
    expect(bot.calls.some((c: string) => c.includes("menu:") && c.includes("lang=en"))).toBe(true);
    const sec = fakeBot();
    await handleAtharBotUpdate(sec, row, { message: { chat: { id: 3 }, from: { id: 11 }, text: "/mystery" } });
    expect(sec.sent[0].text).toBe("🎁 Mystery boxes");
    expect(JSON.stringify(sec.sent[0].kb)).toContain("/mystery?lang=en");
    const old = fakeBot();
    await handleAtharBotUpdate(old, row, { message: { chat: { id: 3 }, from: { id: 11 }, text: "🕰 Athar" } });
    expect(JSON.stringify(old.sent[0].kb)).toContain("lang=en");
  });

  it("the Share button sends a ready share message with the bot's link, and replies do not resend the menu", async () => {
    const bot = fakeBot();
    await handleAtharBotUpdate(bot, row, { message: { chat: { id: 3 }, from: { id: 11 }, text: "👥 Share Athar" } });
    const sent = bot.sent[0];
    expect(sent.text).toMatch(/share Athar/i);
    expect(JSON.stringify(sent.kb)).toContain("t.me/share/url");
    expect(JSON.stringify(sent.kb)).not.toContain("ref=");   // no referral payload (referrals are deferred by the owner)
    await handleAtharBotUpdate(bot, row, { message: { chat: { id: 3 }, from: { id: 11 }, text: "something else" } });
    expect(bot.sent.at(-1).kb).toBeUndefined();               // a plain reply never brings the collapsed menu back
  });

  it("the match button opens the marriage-match bot with the sender's id as the referral, or says it is unavailable", async () => {
    const none = fakeBot();
    await handleAtharBotUpdate(none, row, { message: { chat: { id: 4 }, from: { id: 21 }, text: "/match" } });
    expect(none.sent[0].text).toMatch(/not available/i);
    expect(none.sent[0].kb).toBeUndefined();
    process.env.NEXT_PUBLIC_MATCH_BOT_URL = "https://t.me/ExampleMatchBot";
    try {
      const bot = fakeBot();
      await handleAtharBotUpdate(bot, row, { message: { chat: { id: 4 }, from: { id: 21 }, text: "💞 Marriage match" } });
      expect(JSON.stringify(bot.sent[0].kb)).toContain("https://t.me/ExampleMatchBot?start=ath_21");
      const ar = fakeBot();
      await handleAtharBotUpdate(ar, row, { message: { chat: { id: 4 }, from: { id: 22 }, text: "/language" } });
      await handleAtharBotUpdate(ar, row, { message: { chat: { id: 4 }, from: { id: 22 }, text: "/match" } });
      expect(JSON.stringify(ar.sent.at(-1)!.kb)).toContain("start=ath_22");
    } finally { delete process.env.NEXT_PUBLIC_MATCH_BOT_URL; }
    const menuBot = fakeBot();
    await handleAtharBotUpdate(menuBot, row, { message: { chat: { id: 5 }, from: { id: 23 }, text: "/start" } });
    expect(JSON.stringify(menuBot.sent[0].kb)).toContain("💞 Marriage match");
    expect(COMMANDS.some((c: any) => c.command === "match")).toBe(true);
  });

  it("the owner panel is a different, admin-only keyboard (the old shared-shape rule is retired by the owner)", async () => {
    const o = fakeBot(), u = fakeBot();
    await handleAtharBotUpdate(o, row, { message: { chat: { id: 1 }, from: { id: 555001 }, text: "/start" } });
    await handleAtharBotUpdate(u, row, { message: { chat: { id: 2 }, from: { id: 9 }, text: "/start" } });
    expect(JSON.stringify(o.sent[0].kb)).toContain("الاشتراك الإجباري");
    expect(JSON.stringify(o.sent[0].kb)).not.toContain("/mystery");
    expect(JSON.stringify(u.sent[0].kb)).toContain("/today");
    expect(o.sent[0].kb.is_persistent).toBeFalsy();
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
    expect(ownerIn.sent[0].text).toContain("لوحة أدمن أثر");
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
