import { setRichOverride, richMode } from "@/lib/telegramRich";
import { refreshTgFeatures, setTgAudience, setGuestMode, setTelegramSetting, readBotInfo, inviteLink, TG_SETTINGS, _resetTgFeatures } from "@/lib/tgFeatures";
import { guestQuestion, handleGuestMessage, _resetGuest } from "@/lib/tgGuest";
import { threadStore, threadTransformer, rememberThread } from "@/lib/tgThread";

function fakeDb() {
  const t = new Map<string, string>();
  return {
    t,
    async exec(sql: string, ...a: any[]) { if (/INSERT INTO coder_flags/.test(sql)) t.set(a[0], a[1]); },
    async query(_sql: string, ...keys: string[]) { return keys.filter((k) => t.has(k)).map((k) => ({ key: k, value: t.get(k)! })); },
  } as any;
}

describe("Telegram feature switches (panel)", () => {
  beforeEach(() => { _resetTgFeatures(); _resetGuest(); });

  it("the stored rich-message switch wins over the env default and is read back", async () => {
    const db = fakeDb();
    await setTgAudience("tg_rich", "all", db);
    expect((await refreshTgFeatures(db, true)).rich).toBe("all");
    expect(richMode()).toBe("all");
    await setTgAudience("tg_rich", "off", db);
    expect(richMode()).toBe("off");
    await expect(setTgAudience("tg_rich", "bogus" as any, db)).rejects.toThrow();
  });

  it("only whitelisted Telegram settings can be switched, and the value is sent as a boolean", async () => {
    const calls: any[] = [];
    const api: any = { raw: { setMySettings: async (p: any) => { calls.push(p); return true; } } };
    await setTelegramSetting(api, "has_topics_enabled", true);
    expect(calls[0]).toEqual({ has_topics_enabled: true });
    await expect(setTelegramSetting(api, "can_join_groups", true)).rejects.toThrow("not allowed");
    await expect(setTelegramSetting(api, "supports_guest_queries", true)).rejects.toThrow("not allowed");   // guest has its own control
    expect(TG_SETTINGS).toEqual(["has_topics_enabled", "allows_users_to_create_topics", "has_topic_sidebar"]);
  });

  it("guest mode is ONE control: Telegram first (a refusal leaves our flag untouched), then ours", async () => {
    const db = fakeDb();
    const calls: any[] = [];
    const api: any = { raw: { setMySettings: async (p: any) => { calls.push(p); return true; } } };
    await setGuestMode(api, "owner", db);
    expect(calls[0]).toEqual({ supports_guest_queries: true });
    expect((await refreshTgFeatures(db, true)).guest).toBe("owner");
    const refusing: any = { raw: { setMySettings: async () => { throw new Error("Bad Request: not allowed"); } } };
    await expect(setGuestMode(refusing, "all", db)).rejects.toThrow();
    expect((await refreshTgFeatures(db, true)).guest).toBe("owner");        // unchanged
    await setGuestMode(api, "off", db);
    expect(calls[1]).toEqual({ supports_guest_queries: false });
    expect((await refreshTgFeatures(db, true)).guest).toBe("off");
  });

  it("the Business (Secretary mode) switch is stored, read back and off by default", async () => {
    const db = fakeDb();
    expect((await refreshTgFeatures(db, true)).business).toBe("off");
    await setTgAudience("tg_business", "owner", db);
    expect((await refreshTgFeatures(db, true)).business).toBe("owner");
    await expect(setTgAudience("tg_business", "bogus" as any, db)).rejects.toThrow();
  });

  it("reads the bot's real state and builds the invite link", async () => {
    const api: any = { raw: { getMe: async (...args: unknown[]) => { if (args.length) throw new Error("Incorrect abort signal instance found! You passed two payloads to 'getMe'"); return ({ username: "NovaBot", supports_guest_queries: true, has_topics_enabled: true, allows_users_to_create_topics: false, has_topic_sidebar: true }); } } };
    expect(await readBotInfo(api)).toEqual({ username: "NovaBot", guest: true, topics: true, usersCreateTopics: false, sidebar: true, business: false });
    expect(inviteLink("NovaBot")).toBe("https://t.me/botinvite/NovaBot");
    expect(inviteLink("")).toBe("");
  });

  it("guest mode answers nobody while off, and a stranger only when 'all'", async () => {
    const db = fakeDb();
    const answers: any[] = [];
    const api: any = { raw: { answerGuestQuery: async (p: any) => { answers.push(p); return {}; } } };
    const msg = { guest_query_id: "q1", from: { id: 999 }, text: "@NovaBot ما عاصمة سوريا؟" };
    expect(guestQuestion(msg, "NovaBot")).toBe("ما عاصمة سوريا؟");
    // the module reads the audience through the shared Prisma db; with the table empty it is off
    expect(await handleGuestMessage(api, msg, "NovaBot")).toBe("ignored");
    expect(answers).toHaveLength(0);
    void db;
  });

  it("a guest answer comes from the caller's OWN model (Sham Pro or Nova), never the other one", async () => {
    const answers: any[] = [];
    const api: any = { raw: { answerGuestQuery: async (p: any) => { answers.push(p); return {}; } } };
    const asked: string[] = [];
    const answer = async (m: string) => { asked.push(m); return m === "sham_v2" ? "" : "nova says"; };
    const all = async () => "all" as const;
    expect(await handleGuestMessage(api, { guest_query_id: "q1", from: { id: 111 }, text: "@NovaBot hi" }, "NovaBot", { audience: all, modelOf: async () => "coder", answer })).toBe("answered");
    expect(answers[0].result.title).toBe("Nova AI");
    expect(answers[0].result.input_message_content.message_text).toBe("nova says");
    // Sham Pro fails: the reply says so, and Nova is NOT asked
    await handleGuestMessage(api, { guest_query_id: "q2", from: { id: 112 }, text: "@NovaBot hi" }, "NovaBot", { audience: all, modelOf: async () => "sham_v2", answer });
    expect(asked).toEqual(["coder", "sham_v2"]);
    expect(answers[1].result.title).toBe("Sham Pro");
    expect(answers[1].result.input_message_content.message_text).toContain("شام برو");
    // the model cannot be read: refuse, ask nobody
    await handleGuestMessage(api, { guest_query_id: "q3", from: { id: 113 }, text: "@NovaBot hi" }, "NovaBot", { audience: all, modelOf: async () => { throw new Error("db"); }, answer });
    expect(asked).toHaveLength(2);
    expect(answers[2].result.input_message_content.message_text).toContain("لم أرسل");
  });

  it("the thread of the incoming topic message is added to answers for that chat only", async () => {
    const seen: any[] = [];
    const call = threadTransformer(async (m: string, p: any) => { seen.push([m, p]); return {}; });
    await threadStore.run({ chatId: 10, threadId: 77 }, async () => {
      await call("sendMessage", { chat_id: 10, text: "a" });
      await call("sendMessage", { chat_id: 11, text: "b" });                              // another chat: untouched
      await call("sendMessage", { chat_id: 10, text: "c", message_thread_id: 5 });         // an explicit thread wins
      await call("getMe", { chat_id: 10 });                                                // not a send method
      await call("sendRichMessageDraft", { chat_id: 10, draft_id: 1 });
    });
    expect(seen[0][1].message_thread_id).toBe(77);
    expect(seen[1][1].message_thread_id).toBeUndefined();
    expect(seen[2][1].message_thread_id).toBe(5);
    expect(seen[3][1].message_thread_id).toBeUndefined();
    expect(seen[4][1].message_thread_id).toBe(77);
    await call("sendMessage", { chat_id: 10, text: "outside" });                           // outside any update: untouched
    expect(seen[5][1].message_thread_id).toBeUndefined();
    void rememberThread; void setRichOverride;
  });
});
