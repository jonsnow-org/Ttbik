// Zenobia: season scoring (pure) and the bot (Telegram and the database are stubs).
const rows = new Map<string, any>();
const sql: string[] = [];
let seasonRows: any[] = [];
let passOpen = false;
let jettonSet = "";
let holdsCoinNow = false;
let paymentTx = "";
let passRows: any[] = [];
let passInserts = 0;
const channelSet: (string | null)[] = [];
const members = new Set<number>();
jest.mock("@/lib/prisma", () => ({
  prisma: {
    $executeRawUnsafe: async (q: string, ...a: any[]) => {
      sql.push(q);
      if (q.startsWith("INSERT INTO zenobia_user")) { const k = `${a[0]}:${a[1]}`; if (!rows.has(k)) rows.set(k, { lang: "en", name: a[2], joined_at: new Date(), points: 0, streak: 0, last_checkin: null, wallet: null, ref_by: a[3] }); }
      else if (q.includes("SET lang=")) rows.get(`${a[0]}:${a[1]}`).lang = a[2];
      else if (q.includes("SET points = points + $3")) { const r = rows.get(`${a[0]}:${a[1]}`); r.points += a[2]; r.streak = a[3]; r.last_checkin = new Date(); }
      else if (q.includes("SET points = points + 5")) rows.get(`${a[0]}:${a[1]}`).points += 5;
      else if (q.includes("SET wallet=")) rows.get(`${a[0]}:${a[1]}`).wallet = a[2];
      return 1;
    },
    $bogus: 0,
    bot: { update: async ({ data }: any) => { channelSet.push(data.requiredChannel); return {}; } },
    $queryRawUnsafe: async (q: string, ...a: any[]) => {
      if (q.startsWith("SELECT lang")) { const r = rows.get(`${a[0]}:${a[1]}`); return r ? [{ ...r }] : []; }
      if (q.startsWith("SELECT v FROM zenobia_config") && q.includes("'jetton'")) return jettonSet ? [{ v: jettonSet }] : [];
      if (q.startsWith("SELECT v FROM zenobia_config")) return passOpen ? [{ v: "on" }] : [];
      if (q.startsWith("SELECT pay_tx")) return [];
      if (q.startsWith("SELECT idx, status, item FROM zenobia_passport")) return passRows;
      if (q.includes("INSERT INTO zenobia_passport") && q.includes("RETURNING idx")) { passInserts += 1; return [{ idx: 1 }]; }
      if (q.startsWith("SELECT season")) return seasonRows;
      if (q.includes("AS rank")) return [{ rank: 1, total: rows.size }];
      if (q.includes("ORDER BY points")) return [...rows.values()].filter((r) => r.points > 0).map((r) => ({ name: r.name, points: r.points }));
      return [{ n: rows.size }];
    },
  },
}));
jest.mock("@/lib/botVisit", () => ({ recordBotVisit: async () => undefined }));
import { Address } from "@ton/core";
(global as any).fetch = async (url: string) => {
  if (/\/accounts\/[^/]+\/jettons\//.test(url)) return holdsCoinNow ? { ok: true, status: 200, json: async () => ({ balance: "5" }) } : { ok: false, status: 404, json: async () => ({}) };
  if (/blockchain\/accounts/.test(url)) return { ok: true, status: 200, json: async () => ({ transactions: paymentTx ? [{ hash: paymentTx, success: true, in_msg: { source: { address: Address.parse("UQBt3hzFFJ11GjBjzD523m3NnyhqRNyfKCmzVq9_zVfjQJSz").toRawString() } , value: 60000000, decoded_body: { text: "ZNBP-7" } } }] : [] }) };
  return { ok: false, status: 500, json: async () => ({}) };
};
import { computeSeason, seasonHash, sealSvg, lifeStage, titleFor, type PersonSeason } from "../zenobiaScore";
import { handleZenobiaBotUpdate } from "../zenobiaBotLogic";

const P = (id: string, o: Partial<PersonSeason> = {}): PersonSeason => ({ id, avgBal: 100, volume: 100, accum: 10, startBal: 100, sold: 0, ...o });

describe("Zenobia season scoring", () => {
  it("shares add up to the weights for identical people", () => {
    const r = computeSeason([P("a"), P("b")]);
    expect(r[0].score).toBeCloseTo(0.5, 6);
    expect(r[1].score).toBeCloseTo(0.5, 6);
  });
  it("is deterministic and order-independent", () => {
    const a = computeSeason([P("a"), P("b", { avgBal: 400 }), P("c", { avgBal: 9 })]);
    const b = computeSeason([P("c", { avgBal: 9 }), P("a"), P("b", { avgBal: 400 })]);
    expect(a).toEqual(b);
    expect(seasonHash("2026-W42", a)).toBe(seasonHash("2026-W42", b));
    expect(seasonHash("2026-W42", a)).toMatch(/^[0-9a-f]{64}$/);
    expect(seasonHash("2026-W43", a)).not.toBe(seasonHash("2026-W42", a));
  });
  it("concave transform: a whale gets far less than its balance share", () => {
    const r = computeSeason([P("whale", { avgBal: 10000, volume: 0, accum: 0 }), ...Array.from({ length: 99 }, (_, i) => P("s" + i, { avgBal: 100, volume: 0, accum: 0 }))]);
    const whale = r.find((x) => x.id === "whale")!;
    expect(whale.parts.hold).toBeLessThan(10000 / (10000 + 9900)); // linear share would be ~50%
    expect(whale.parts.hold).toBeCloseTo(100 / (100 + 99 * 10), 6);
  });
  it("wash trading is capped at 3x the average balance", () => {
    const capped = computeSeason([P("w", { avgBal: 10, volume: 1000 }), P("h", { avgBal: 10, volume: 30 })]);
    expect(capped.find((x) => x.id === "w")!.parts.trade).toBeCloseTo(capped.find((x) => x.id === "h")!.parts.trade, 8);
  });
  it("selling within the free 25% costs nothing; more lowers the score but never to zero", () => {
    const f = (sold: number) => computeSeason([P("x", { sold })]).find((r) => r.id === "x")!.parts.factor;
    expect(f(25)).toBe(1);
    expect(f(50)).toBeCloseTo(0.75, 6);
    expect(f(100)).toBe(0.25);
    expect(f(1000)).toBe(0.2);
  });
  it("titles, life stages and the seal", () => {
    expect(titleFor(1, 100).en).toBe("Queen's Guard");
    expect(titleFor(100, 100).en).toBe("Bedouin");
    expect(lifeStage(3)).toBe("child"); expect(lifeStage(7)).toBe("queen"); expect(lifeStage(21)).toBe("warrior");
    expect(lifeStage(30, { soldAll: true })).toBe("captive"); expect(lifeStage(30, { burned: true, soldAll: true })).toBe("legend");
    const h = seasonHash("s", computeSeason([P("a")]));
    expect(sealSvg(h)).toBe(sealSvg(h));
    expect(sealSvg(h)).not.toBe(sealSvg(h.replace(/^./, h[0] === "a" ? "b" : "a")));
    expect(sealSvg(h).startsWith("<svg")).toBe(true);
  });
});

let mid = 100;
function fakeBot() {
  const sent: { chat: number; text: string; kb?: any; id: number }[] = [];
  const deleted: number[] = [];
  const edits: string[] = [];
  return { sent, deleted, edits, api: {
    sendMessage: async (chat: number, text: string, o?: any) => { const id = ++mid; sent.push({ chat, text, kb: o?.reply_markup, id }); return { message_id: id }; },
    sendPhoto: async (chat: number, _p: string, o?: any) => { const id = ++mid; sent.push({ chat, text: "[photo] " + (o?.caption || ""), kb: o?.reply_markup, id }); return { message_id: id }; },
    editMessageMedia: async (_c: number, _m: number, media: any) => { edits.push(media.caption); return {}; },
    deleteMessage: async (_c: number, id: number) => { deleted.push(id); return true; },
    answerCallbackQuery: async () => undefined,
    getChatMember: async (_c: string, u: number) => { if (members.has(u)) return { status: "member" }; throw Object.assign(new Error("x"), { description: "Bad Request: user not found" }); },
    getMe: async () => ({ username: "ZenobiaBot" }),
  } } as any;
}
const row = { id: "z1", ownerId: "555001", token: "123456:TESTTOKEN" } as any;
const AR = /[؀-ۿ]/;
const msg = (id: number, text: string, lang = "en") => ({ message: { message_id: ++mid, chat: { id }, from: { id, first_name: "Sam", language_code: lang }, text } });
const cb = (id: number, data: string) => ({ callback_query: { id: "q", from: { id, first_name: "Sam" }, data, message: { message_id: 1, chat: { id } } } });
const flat = (kb: any) => JSON.stringify(kb);

describe("Zenobia bot", () => {
  beforeEach(() => { passOpen = false; jettonSet = ""; holdsCoinNow = false; paymentTx = ""; passRows = []; passInserts = 0; seasonRows = []; rows.clear(); sql.length = 0; channelSet.length = 0; members.clear(); });
  it("greets in English even a user whose Telegram is Arabic, with a persistent menu and the table created on first use", async () => {
    const bot = fakeBot();
    await handleZenobiaBotUpdate(bot, row, msg(7, "/start", "ar"));
    expect(bot.sent.length).toBe(1);
    expect(bot.sent[0].text).toMatch(/^🏛 Welcome to the Zenobia caravan/);
    expect(AR.test(bot.sent[0].text)).toBe(false);
    expect(bot.sent[0].kb.is_persistent).toBeFalsy(); // collapsible with the Back button
    expect(bot.sent[0].kb.keyboard.length).toBeGreaterThan(0);
    expect(flat(bot.sent[0].kb)).toContain("Invite friends");
    expect(sql[0]).toMatch(/CREATE TABLE IF NOT EXISTS zenobia_user/);
  });
  it("replies to menu buttons do not resend the keyboard (so Back can collapse it); the welcome does", async () => {
    const bot = fakeBot();
    await handleZenobiaBotUpdate(bot, row, msg(7, "/start"));
    for (const label of ["🏆 Leaderboard", "ℹ️ About", "✅ Check-in"]) {
      await handleZenobiaBotUpdate(bot, row, msg(7, label));
      expect(bot.sent.at(-1)!.kb).toBeUndefined();
    }
    expect(bot.deleted).toEqual([]);
    expect(bot.sent.length).toBe(4);
    await handleZenobiaBotUpdate(bot, row, msg(7, "/start"));
    expect(bot.sent.at(-1)!.kb.keyboard.length).toBeGreaterThan(0);
  });
  it("switches to Arabic with the menu button and remembers it", async () => {
    const bot = fakeBot();
    await handleZenobiaBotUpdate(bot, row, msg(7, "/start"));
    await handleZenobiaBotUpdate(bot, row, msg(7, "🌐 العربية"));
    expect(AR.test(bot.sent.at(-1)!.text)).toBe(true);
    expect(flat(bot.sent.at(-1)!.kb)).toContain("ادعُ صديقًا");
    await handleZenobiaBotUpdate(bot, row, msg(7, "ℹ️ عن زنوبيا"));
    expect(bot.sent.at(-1)!.text).toMatch(/زنوبيا/);
  });
  it("daily check-in gives points once a day", async () => {
    const bot = fakeBot();
    await handleZenobiaBotUpdate(bot, row, msg(7, "/start"));
    await handleZenobiaBotUpdate(bot, row, msg(7, "✅ Check-in"));
    expect(bot.sent.at(-1)!.text).toMatch(/Checked in. Streak: 1 day · Points: 1/);
    await handleZenobiaBotUpdate(bot, row, msg(7, "/checkin"));
    expect(bot.sent.at(-1)!.text).toMatch(/already checked in/);
  });
  it("has an invite button that shares the person's own link", async () => {
    const bot = fakeBot();
    await handleZenobiaBotUpdate(bot, row, msg(7, "/start"));
    await handleZenobiaBotUpdate(bot, row, msg(7, "👥 Invite friends"));
    const last = bot.sent.at(-1)!;
    expect(last.text).toContain("t.me/ZenobiaBot?start=ref_7");
    expect(flat(last.kb)).toContain("t.me/share/url?url=");
    expect(flat(last.kb)).toContain(encodeURIComponent("https://t.me/ZenobiaBot?start=ref_7"));
  });
  it("a referral gives the inviter 5 points, and nobody can refer themselves", async () => {
    const bot = fakeBot();
    await handleZenobiaBotUpdate(bot, row, msg(111111, "/start"));
    await handleZenobiaBotUpdate(bot, row, msg(222222, "/start ref_111111"));
    expect(rows.get("z1:111111").points).toBe(5);
    await handleZenobiaBotUpdate(bot, row, msg(333333, "/start ref_333333"));
    expect(rows.get("z1:333333").ref_by).toBeNull();
  });
  it("the wallet button gives a signed connect link; a verified wallet is shown", async () => {
    const bot = fakeBot();
    await handleZenobiaBotUpdate(bot, row, msg(7, "/start"));
    await handleZenobiaBotUpdate(bot, row, msg(7, "🔗 Wallet"));
    const last = bot.sent.at(-1)!;
    expect(last.text).toMatch(/Connect your TON wallet to prove it is yours/);
    expect(last.text).toMatch(/never ask for your recovery phrase/);
    const url = JSON.stringify(last.kb);
    expect(url).toContain("/zenobia/link.html?bot=z1&t=7.");
    rows.get("z1:7").wallet = "UQtest"; rows.get("z1:7").wallet_verified = true;
    await handleZenobiaBotUpdate(bot, row, msg(7, "🔗 Wallet"));
    expect(bot.sent.at(-1)!.text).toMatch(/Verified wallet:\nUQtest/);
  });
  it("shows the journey stage, and the quote on the captive and legend stages in place", async () => {
    const bot = fakeBot();
    await handleZenobiaBotUpdate(bot, row, msg(7, "/start"));
    await handleZenobiaBotUpdate(bot, row, msg(7, "🗺 My journey"));
    expect(bot.sent.at(-1)!.text).toMatch(/stage: Child/);
    await handleZenobiaBotUpdate(bot, row, msg(7, "👑 Stages"));
    const n = bot.sent.length;
    await handleZenobiaBotUpdate(bot, row, cb(7, "zn:st:3"));
    await handleZenobiaBotUpdate(bot, row, cb(7, "zn:st:4"));
    expect(bot.sent.length).toBe(n); // edited in place, nothing new in the chat
    expect(bot.edits.filter((c) => c.includes("A fine thing is a fetter on the wrist")).length).toBe(2);
  });
  it("only the owner sees stats", async () => {
    const bot = fakeBot();
    await handleZenobiaBotUpdate(bot, row, msg(7, "/stats"));
    expect(bot.sent.some((s) => /Owner stats/.test(s.text))).toBe(false);
    await handleZenobiaBotUpdate(bot, row, msg(555001, "/stats"));
    expect(bot.sent.at(-1)!.text).toMatch(/Owner stats/);
  });
  it("the owner sets a mandatory channel; others must join first, members get in", async () => {
    members.add(555001);
    const bot = fakeBot();
    await handleZenobiaBotUpdate(bot, row, msg(555001, "/channel https://t.me/Zenobiaton"));
    expect(channelSet).toEqual(["Zenobiaton"]);
    expect(bot.sent.at(-1)!.text).toMatch(/Mandatory subscription is on: @Zenobiaton/);
    const gated = { ...row, requiredChannel: "Zenobiaton" };
    await handleZenobiaBotUpdate(bot, gated, msg(7, "/start"));
    expect(bot.sent.at(-1)!.text).toMatch(/join the Zenobia channel first/);
    members.add(7);
    await handleZenobiaBotUpdate(bot, gated, cb(7, "zn:start"));
    expect(bot.sent.at(-1)!.text).toMatch(/Welcome to the Zenobia caravan/);
    await handleZenobiaBotUpdate(bot, row, msg(555001, "/channel off"));
    expect(channelSet.at(-1)).toBeNull();
  });
  it("lets everyone in when the bot cannot check the channel (not an admin there)", async () => {
    const bot = fakeBot();
    bot.api.getChatMember = async () => { throw Object.assign(new Error("x"), { description: "Bad Request: member list is inaccessible" }); };
    await handleZenobiaBotUpdate(bot, { ...row, requiredChannel: "Zenobiaton" }, msg(9, "/start"));
    expect(bot.sent[0].text).toMatch(/Welcome to the Zenobia caravan/);
  });
  it("/season says so when nothing has closed, then shows the fingerprint and the seal link", async () => {
    const bot = fakeBot();
    await handleZenobiaBotUpdate(bot, row, msg(7, "/start"));
    await handleZenobiaBotUpdate(bot, row, msg(7, "/season"));
    expect(bot.sent.at(-1)!.text).toMatch(/No season has closed yet/);
    seasonRows = [{ season: "2026-W42", hash: "ab".repeat(32), results: [{ id: "7", score: 0.5 }] }];
    await handleZenobiaBotUpdate(bot, row, msg(7, "/season"));
    const txt = bot.sent.at(-1)!.text;
    expect(txt).toMatch(/Season 2026-W42/); expect(txt).toContain("ab".repeat(32)); expect(txt).toContain("/api/zenobia/seal/2026-W42.svg");
  });
  it("only the owner can set the jetton, and a bad address is refused", async () => {
    const bot = fakeBot();
    await handleZenobiaBotUpdate(bot, row, msg(7, "/jetton EQAvlWFDxGF2lXm67y4yzC17wYKD9A0guwPkMs1gOsM__NOT"));
    expect(bot.sent.some((s) => /Jetton set/.test(s.text))).toBe(false);
    await handleZenobiaBotUpdate(bot, row, msg(555001, "/jetton nonsense"));
    expect(bot.sent.at(-1)!.text).toMatch(/Usage: \/jetton/);
    await handleZenobiaBotUpdate(bot, row, msg(555001, "/jetton EQAvlWFDxGF2lXm67y4yzC17wYKD9A0guwPkMs1gOsM__NOT 9"));
    expect(bot.sent.at(-1)!.text).toMatch(/Jetton set: .* \(decimals 9\)/);
    expect(sql.some((q) => /zenobia_config/.test(q) && /jetton/.test(q))).toBe(true);
  });
  it("only the owner can link a passport to himself, and the number is checked", async () => {
    const bot = fakeBot();
    await handleZenobiaBotUpdate(bot, row, msg(7, "/passport 0"));
    expect(sql.some((q) => /zenobia_passport/.test(q) && /INSERT/.test(q))).toBe(false);
    await handleZenobiaBotUpdate(bot, row, msg(555001, "/passport x"));
    expect(bot.sent.at(-1)!.text).toMatch(/Usage: \/passport/);
    await handleZenobiaBotUpdate(bot, row, msg(555001, "/passport 0"));
    expect(bot.sent.at(-1)!.text).toMatch(/Passport #0 is now linked to you/);
    expect(sql.some((q) => /INSERT INTO zenobia_passport/.test(q))).toBe(true);
  });
  it("the passport button points to the website, mints nothing from the bot, and still shows an older free passport", async () => {
    const bot = fakeBot();
    await handleZenobiaBotUpdate(bot, row, msg(7, "/start"));
    await handleZenobiaBotUpdate(bot, row, msg(7, "🪪 Passport"));
    expect(bot.sent.at(-1)!.text).toMatch(/Silk Road Passport/);
    expect(passInserts).toBe(0);
    passOpen = true;
    await handleZenobiaBotUpdate(bot, row, msg(7, "🪪 Passport"));
    expect(bot.sent.at(-1)!.text).toMatch(/Silk Road Passport/); // the bot only points to the website; nothing is minted from here
    expect(passInserts).toBe(0);
    passRows = [{ idx: 1, status: "minted", item: "EQabc" }];
    await handleZenobiaBotUpdate(bot, row, msg(7, "🪪 Passport"));
    expect(bot.sent.at(-1)!.text).toContain("https://tonviewer.com/EQabc"); // an older free passport still shows
  });
  it("only the owner opens or closes passports, and the Arabic menu has the button", async () => {
    const bot = fakeBot();
    await handleZenobiaBotUpdate(bot, row, msg(7, "/passports on"));
    expect(sql.some((q) => /INSERT INTO zenobia_config/.test(q) && /passports/.test(q))).toBe(false);
    await handleZenobiaBotUpdate(bot, row, msg(555001, "/passports maybe"));
    expect(bot.sent.at(-1)!.text).toMatch(/Usage: \/passports/);
    await handleZenobiaBotUpdate(bot, row, msg(555001, "/passports on"));
    expect(bot.sent.at(-1)!.text).toMatch(/Passports are open/);
    await handleZenobiaBotUpdate(bot, row, msg(8, "/start"));
    await handleZenobiaBotUpdate(bot, row, msg(8, "🌐 العربية"));
    expect(JSON.stringify(bot.sent.at(-1)!.kb)).toContain("🪪 الجواز");
  });
});

describe("Silk Road Passport", () => {
  const { silkPriceGram, silkStage, silkMetadata, isDead, SILK_CAP, LOCK_DAYS } = require("../zenobiaSilk");
  const { holdsCoin } = require("../zenobiaPay");
  it("price rises with the number: 1, then 2, then 3 GRAM; 2500 in all", () => {
    expect([0, 499, 500, 1499, 1500, 2499].map(silkPriceGram)).toEqual([1, 1, 2, 2, 3, 3]);
    expect(SILK_CAP).toBe(2500); expect(LOCK_DAYS).toBe(30);
  });
  it("stage follows the passport's age; Captive without ZNB; Legend when sent to the dead address", () => {
    expect([0, 9, 10, 29, 30, 400].map((d) => silkStage(d))).toEqual(["child", "child", "queen", "queen", "warrior", "warrior"]);
    expect(silkStage(100, { captive: true })).toBe("captive");
    expect(silkStage(100, { captive: true, legend: true })).toBe("legend");
    expect(isDead("0:" + "0".repeat(64))).toBe(true); expect(isDead(undefined)).toBe(true); expect(isDead("0:" + "1".repeat(64))).toBe(false);
  });
  it("metadata says when it can be traded", () => {
    const now = new Date("2026-12-01T00:00:00Z");
    const young = silkMetadata({ index: 7, mintedAt: new Date("2026-11-20T00:00:00Z"), now }, "https://x");
    expect(young.name).toContain("#7"); expect(young.attributes.find((a: any) => a.trait_type === "Tradable").value).toBe("After day 30");
    expect(young.image).toBe("https://x/zenobia/stage-2-queen-sq.jpg");
    const old = silkMetadata({ index: 7, mintedAt: new Date("2026-10-01T00:00:00Z"), now }, "https://x");
    expect(old.attributes.find((a: any) => a.trait_type === "Tradable").value).toBe("Yes");
    expect(old.image).toContain("stage-3-warrior-sq");
    expect(silkMetadata({ index: 7, mintedAt: new Date("2026-10-01T00:00:00Z"), captive: true, now }, "https://x").image).toContain("stage-4-captive-sq");
  });
  it("reads the holder's balance against a minimum", async () => {
    const bal = (b: string | null) => (async () => (b === null ? { ok: false, status: 404 } : { ok: true, status: 200, json: async () => ({ balance: b }) })) as any;
    expect(await holdsCoin("UQx", "EQx", { fetchFn: bal("5") })).toBe(true);
    expect(await holdsCoin("UQx", "EQx", { fetchFn: bal("5"), minBalance: 6n })).toBe(false);
    expect(await holdsCoin("UQx", "EQx", { fetchFn: bal("0") })).toBe(false);
    expect(await holdsCoin("UQx", "EQx", { fetchFn: bal(null) })).toBe(false);
  });
});

describe("Caravan Board", () => {
  const { buildBoard } = require("../zenobiaBoard");
  const raw = (c: string) => "0:" + c.repeat(64);
  const d = (n: number) => `2026-12-${String(n).padStart(2, "0")}`;
  it("ranks by consecutive holding days, then balance; a break resets the streak; pools are not ranked", () => {
    const rows = [
      // a: held 1..5 (5 days); b: held 3..5 but sold on day 2 earlier gap; c: 5 days, bigger balance; pool: huge share
      ...[1, 2, 3, 4, 5].map((n) => ({ day: d(n), owner: raw("a"), balance: 100n })),
      ...[1, 3, 4, 5].map((n) => ({ day: d(n), owner: raw("b"), balance: 100n })),
      ...[1, 2, 3, 4, 5].map((n) => ({ day: d(n), owner: raw("c"), balance: 300n })),
      ...[1, 2, 3, 4, 5].map((n) => ({ day: d(n), owner: raw("e"), balance: 9000n })),
      { day: d(5), owner: raw("f"), balance: 100n }, // new today: 1 day
      ...[1, 2, 3].map((n) => ({ day: d(n), owner: raw("g"), balance: 100n })), // left before today
    ];
    const b = buildBoard(rows);
    expect(b.latest).toBe(d(5));
    expect(b.entries.map((e: any) => [e.owner[2], e.days, e.rank])).toEqual([["c", 5, 1], ["a", 5, 2], ["b", 3, 3], ["f", 1, 4]]);
  });
  it("empty input gives an empty board", () => {
    expect(buildBoard([]).entries).toEqual([]);
  });
});
