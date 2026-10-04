import { FakeDb } from "./fakeDb";
import { PUSH_COOLDOWN_MS, PUSH_HOURLY_CAP, notify, pushDecision, pushKeyboard, pushText, savePrefs } from "../mediaNotify";

const sent: any[] = [];
beforeEach(() => {
  sent.length = 0;
  process.env.BOT_TOKEN = "123:TEST";
  (global as any).fetch = async (_u: string, init: any) => { sent.push(JSON.parse(init.body)); return { json: async () => ({ ok: true }) } as any; };
});

describe("who gets a bot message", () => {
  const base = { prefs: { pushOff: false, offTypes: [] as any[] }, type: "like" as const, lastSameTypeAt: null as number | null, pushesLastHour: 0, now: 1_000_000 };
  it("sends by default", () => expect(pushDecision(base).send).toBe(true));
  it("respects 'stop everything' and 'stop this kind'", () => {
    expect(pushDecision({ ...base, prefs: { pushOff: true, offTypes: [] } })).toEqual({ send: false, reason: "push-off" });
    expect(pushDecision({ ...base, prefs: { pushOff: false, offTypes: ["like"] } })).toEqual({ send: false, reason: "type-off" });
    expect(pushDecision({ ...base, prefs: { pushOff: false, offTypes: ["comment"] } }).send).toBe(true);
  });
  it("waits out the cooldown and never passes the hourly cap", () => {
    expect(pushDecision({ ...base, lastSameTypeAt: base.now - 1000 }).reason).toBe("cooldown");
    expect(pushDecision({ ...base, lastSameTypeAt: base.now - PUSH_COOLDOWN_MS.like - 1 }).send).toBe(true);
    expect(pushDecision({ ...base, pushesLastHour: PUSH_HOURLY_CAP }).reason).toBe("hourly-cap");
  });
  it("every message offers the buttons: open it, stop this kind, settings", () => {
    const kb = pushKeyboard("comment", "https://x.test/mini-app");
    const flat = kb.inline_keyboard.flat() as any[];
    expect(flat.some((b) => b.web_app?.url === "https://x.test/mini-app")).toBe(true);
    expect(flat.some((b) => b.callback_data === "mn:off:comment")).toBe(true);
    expect(flat.some((b) => b.callback_data === "mn:menu")).toBe(true);
    expect(pushText("like", "سارة")).toContain("سارة");
  });
});

describe("notify (database + bot)", () => {
  it("stores the notification and sends one bot message with the stop button", async () => {
    const db: any = new FakeDb();
    const r = await notify(db, { toId: "1", fromId: "2", fromName: "علي", type: "comment", postId: "p1", extra: "مرحبا" });
    expect(r.stored).toBe(true); expect(r.pushed).toBe(true);
    expect(db.tables.media_notifications).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(JSON.stringify(sent[0].reply_markup)).toContain("mn:off:comment");
  });
  it("never to yourself", async () => {
    const db: any = new FakeDb();
    const r = await notify(db, { toId: "1", fromId: "1", fromName: "أنا", type: "like", postId: "p" });
    expect(r.stored).toBe(false); expect(sent).toHaveLength(0);
  });
  it("a like, unlike, like loop is one notification and one message", async () => {
    const db: any = new FakeDb();
    await notify(db, { toId: "1", fromId: "2", fromName: "علي", type: "like", postId: "p" });
    const again = await notify(db, { toId: "1", fromId: "2", fromName: "علي", type: "like", postId: "p" });
    expect(again.reason).toBe("duplicate");
    expect(db.tables.media_notifications).toHaveLength(1); expect(sent).toHaveLength(1);
  });
  it("a person who stopped likes gets the in-app row but no bot message; other kinds still arrive", async () => {
    const db: any = new FakeDb();
    await savePrefs(db, "1", { pushOff: false, offTypes: ["like"] });
    await notify(db, { toId: "1", fromId: "2", fromName: "علي", type: "like", postId: "p" });
    expect(db.tables.media_notifications).toHaveLength(1); expect(sent).toHaveLength(0);
    await notify(db, { toId: "1", fromId: "3", fromName: "ليلى", type: "follow" });
    expect(sent).toHaveLength(1);
  });
  it("a second comment within the cooldown is stored but not pushed again", async () => {
    const db: any = new FakeDb();
    await notify(db, { toId: "1", fromId: "2", fromName: "علي", type: "comment", postId: "p", extra: "أول" });
    await notify(db, { toId: "1", fromId: "3", fromName: "ليلى", type: "comment", postId: "p", extra: "ثان" });
    expect(db.tables.media_notifications).toHaveLength(2); expect(sent).toHaveLength(1);
  });
  it("a blocked pair gets nothing", async () => {
    const db: any = new FakeDb();
    db.tables.media_blocks = [{ user_id: "1", blocked_id: "2" }];
    const r = await notify(db, { toId: "1", fromId: "2", fromName: "علي", type: "like", postId: "p" });
    expect(r.reason).toBe("blocked"); expect(db.tables.media_notifications ?? []).toHaveLength(0); expect(sent).toHaveLength(0);
  });
  it("if the table is missing, the failure is reported, not hidden", async () => {
    const db: any = new FakeDb(); db.failTables.add("media_notifications");
    const r = await notify(db, { toId: "1", fromId: "2", fromName: "علي", type: "comment", postId: "p" });
    expect(r.stored).toBe(false);
  });
});
