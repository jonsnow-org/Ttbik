// Zenobia: season scoring (pure) and the bot (Telegram and the database are stubs).
const rows = new Map<string, any>();
const sql: string[] = [];
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
      if (q.includes("AS rank")) return [{ rank: 1, total: rows.size }];
      if (q.includes("ORDER BY points")) return [...rows.values()].filter((r) => r.points > 0).map((r) => ({ name: r.name, points: r.points }));
      return [{ n: rows.size }];
    },
  },
}));
jest.mock("@/lib/botVisit", () => ({ recordBotVisit: async () => undefined }));
import { Address } from "@ton/core";
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

function fakeBot() {
  const sent: { chat: number; text: string; kb?: any }[] = [];
  return { sent, api: {
    sendMessage: async (chat: number, text: string, o?: any) => { sent.push({ chat, text, kb: o?.reply_markup }); return { message_id: 1 }; },
    sendPhoto: async (chat: number, _p: string, o?: any) => { sent.push({ chat, text: "[photo] " + (o?.caption || "") }); return { message_id: 2 }; },
    answerCallbackQuery: async () => undefined,
    getChatMember: async (_c: string, u: number) => { if (members.has(u)) return { status: "member" }; throw Object.assign(new Error("x"), { description: "Bad Request: user not found" }); },
    getMe: async () => ({ username: "ZenobiaBot" }),
  } } as any;
}
const row = { id: "z1", ownerId: "555001" } as any;
const AR = /[؀-ۿ]/;
const msg = (id: number, text: string, lang = "en") => ({ message: { chat: { id }, from: { id, first_name: "Sam", language_code: lang }, text } });
const cb = (id: number, data: string) => ({ callback_query: { id: "q", from: { id, first_name: "Sam" }, data, message: { chat: { id } } } });

describe("Zenobia bot", () => {
  beforeEach(() => { rows.clear(); sql.length = 0; channelSet.length = 0; members.clear(); });
  it("greets in English even a user whose Telegram is Arabic, creating the table on first use", async () => {
    const bot = fakeBot();
    await handleZenobiaBotUpdate(bot, row, msg(7, "/start", "ar"));
    expect(bot.sent[0].text).toMatch(/^🏛 Welcome to the Zenobia caravan/);
    expect(AR.test(bot.sent[0].text)).toBe(false);
    expect(sql[0]).toMatch(/CREATE TABLE IF NOT EXISTS zenobia_user/);
    expect(bot.sent[1].text).toContain("start=ref_7");
  });
  it("switches to Arabic and remembers it", async () => {
    const bot = fakeBot();
    await handleZenobiaBotUpdate(bot, row, msg(7, "/start"));
    await handleZenobiaBotUpdate(bot, row, cb(7, "zn:lang:ar"));
    expect(AR.test(bot.sent.at(-1)!.text)).toBe(true);
    await handleZenobiaBotUpdate(bot, row, msg(7, "/about"));
    expect(bot.sent.at(-1)!.text).toMatch(/زنوبيا/);
  });
  it("daily check-in gives points once a day", async () => {
    const bot = fakeBot();
    await handleZenobiaBotUpdate(bot, row, msg(7, "/start"));
    await handleZenobiaBotUpdate(bot, row, msg(7, "/checkin"));
    expect(bot.sent.at(-1)!.text).toMatch(/Checked in. Streak: 1 day · Points: 1/);
    await handleZenobiaBotUpdate(bot, row, msg(7, "/checkin"));
    expect(bot.sent.at(-1)!.text).toMatch(/already checked in/);
  });
  it("a referral gives the inviter 5 points, and nobody can refer themselves", async () => {
    const bot = fakeBot();
    await handleZenobiaBotUpdate(bot, row, msg(111111, "/start"));
    await handleZenobiaBotUpdate(bot, row, msg(222222, "/start ref_111111"));
    expect(rows.get("z1:111111").points).toBe(5);
    await handleZenobiaBotUpdate(bot, row, msg(333333, "/start ref_333333"));
    expect(rows.get("z1:333333").ref_by).toBeNull();
  });
  it("saves a valid TON address as unverified and rejects junk", async () => {
    const bot = fakeBot();
    await handleZenobiaBotUpdate(bot, row, msg(7, "/start"));
    await handleZenobiaBotUpdate(bot, row, msg(7, "/link nonsense"));
    expect(bot.sent.at(-1)!.text).toMatch(/not a valid TON address/);
    await handleZenobiaBotUpdate(bot, row, msg(7, "/link " + new Address(0, Buffer.alloc(32, 7)).toString()));
    expect(bot.sent.at(-1)!.text).toMatch(/Saved \(unverified\)/);
  });
  it("shows the journey stage and the captured quote on the captive/legend stages", async () => {
    const bot = fakeBot();
    await handleZenobiaBotUpdate(bot, row, msg(7, "/start"));
    await handleZenobiaBotUpdate(bot, row, msg(7, "/journey"));
    expect(bot.sent.some((s) => /stage: Child/.test(s.text))).toBe(true);
    await handleZenobiaBotUpdate(bot, row, msg(7, "/stages"));
    expect(bot.sent.filter((s) => s.text.includes("A fine thing is a fetter on the wrist")).length).toBe(2);
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
    expect(bot.sent.some((s) => /Welcome to the Zenobia caravan/.test(s.text))).toBe(true);
    await handleZenobiaBotUpdate(bot, row, msg(555001, "/channel off"));
    expect(channelSet.at(-1)).toBeNull();
  });
  it("lets everyone in when the bot cannot check the channel (not an admin there)", async () => {
    const bot = fakeBot();
    bot.api.getChatMember = async () => { throw Object.assign(new Error("x"), { description: "Bad Request: member list is inaccessible" }); };
    await handleZenobiaBotUpdate(bot, { ...row, requiredChannel: "Zenobiaton" }, msg(9, "/start"));
    expect(bot.sent[0].text).toMatch(/Welcome to the Zenobia caravan/);
  });
});
