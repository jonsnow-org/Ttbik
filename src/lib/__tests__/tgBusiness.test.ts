import {
  handleBusinessConnection, handleBusinessMessage, setConnectionModel, connectionsOf, activityOf, forgetConnection, normRights, businessModelFor, _resetBusiness, getConnection,
} from "@/lib/tgBusiness";

// a tiny in-memory stand-in for the two tables (matches the statements tgBusiness.ts issues)
function fakeDb() {
  const conns = new Map<string, any>();
  const log: any[] = [];
  let seq = 0;
  return {
    conns, log,
    async exec(sql: string, ...a: any[]) {
      if (/^CREATE/.test(sql.trim())) return;
      if (/INSERT INTO tg_business_connections/.test(sql)) {
        const [id, user_id, user_chat_id, rights, enabled, model] = a;
        const old = conns.get(id);
        if (old) Object.assign(old, { user_chat_id, rights: JSON.parse(rights), enabled, updated_at: new Date() });
        else conns.set(id, { id, user_id, user_chat_id, rights: JSON.parse(rights), enabled, model, instructions: "", created_at: new Date(), updated_at: new Date() });
        return;
      }
      if (/UPDATE tg_business_connections SET model/.test(sql)) { const c = conns.get(a[1]); if (c && c.user_id === a[2]) c.model = a[0]; return; }
      if (/UPDATE tg_business_connections SET enabled/.test(sql)) { const c = conns.get(a[1]); if (c && c.user_id === a[2]) c.enabled = a[0]; return; }
      if (/UPDATE tg_business_connections SET instructions/.test(sql)) { const c = conns.get(a[1]); if (c && c.user_id === a[2]) c.instructions = a[0]; return; }
      if (/INSERT INTO tg_business_log/.test(sql)) { const [connection_id, user_id, chat_id, model, dir, text, note] = a; log.push({ id: ++seq, connection_id, user_id, chat_id, model, dir, text, note, at: new Date(Date.now() + seq) }); return; }
      if (/DELETE FROM tg_business_log/.test(sql)) { for (let i = log.length - 1; i >= 0; i--) if (log[i].connection_id === a[0] && log[i].user_id === a[1]) log.splice(i, 1); return; }
      if (/DELETE FROM tg_business_connections/.test(sql)) { const c = conns.get(a[0]); if (c && c.user_id === a[1]) conns.delete(a[0]); return; }
      throw new Error("unexpected exec: " + sql);
    },
    async query(sql: string, ...a: any[]) {
      if (/FROM tg_business_connections WHERE id = \$1/.test(sql)) return conns.has(a[0]) ? [conns.get(a[0])] : [];
      if (/FROM tg_business_connections WHERE user_id = \$1/.test(sql)) return [...conns.values()].filter((c) => c.user_id === a[0]);
      if (/FROM tg_business_log WHERE connection_id = \$1 AND chat_id = \$2 AND model = \$3/.test(sql)) {
        return log.filter((r) => r.connection_id === a[0] && r.chat_id === a[1] && r.model === a[2] && ["in", "own", "out"].includes(r.dir)).sort((x, y) => y.id - x.id).slice(0, a[3]);
      }
      if (/FROM tg_business_log WHERE connection_id = \$1 AND user_id = \$2/.test(sql)) return log.filter((r) => r.connection_id === a[0] && r.user_id === a[1]).sort((x, y) => y.id - x.id).slice(0, a[2]);
      throw new Error("unexpected query: " + sql);
    },
  } as any;
}
function fakeApi() {
  const calls: { m: string; p: any }[] = [];
  const mk = (m: string, ret: any = true) => async (p: any) => { calls.push({ m, p }); return ret; };
  return { calls, api: { raw: { sendMessage: mk("sendMessage"), sendChatAction: mk("sendChatAction"), readBusinessMessage: mk("readBusinessMessage"), getBusinessConnection: mk("getBusinessConnection", null) } } as any };
}
const BC = (over: any = {}) => ({ id: "bc1", user: { id: 5001, first_name: "U" }, user_chat_id: 5001, date: 1, rights: { can_reply: true, can_read_messages: true }, is_enabled: true, ...over });
const MSG = (text: string, over: any = {}) => ({ business_connection_id: "bc1", message_id: 7, chat: { id: 9001, type: "private" }, from: { id: 9001, is_bot: false }, text, ...over });

describe("Telegram Business (shared bot replies inside a linked account)", () => {
  beforeEach(() => _resetBusiness());
  const all = async () => "all" as const;
  const noDeny = async () => [] as string[];

  it("keeps only known rights that are true; Sham Pro maps to Sham Pro, everything else to Nova", () => {
    expect(normRights({ can_reply: true, can_read_messages: false, bogus: true })).toEqual({ can_reply: true });
    expect(businessModelFor("sham_v2")).toBe("sham_v2");
    expect(businessModelFor("sham")).toBe("coder");
    expect(businessModelFor(undefined)).toBe("coder");
  });

  it("a new connection takes the model active at link time; an edit keeps the user's choice", async () => {
    const db = fakeDb(); const { api, calls } = fakeApi();
    await handleBusinessConnection(api, BC(), { db, audience: all, activeModel: async () => "sham_v2" });
    expect((await getConnection("bc1", db))!.model).toBe("sham_v2");
    expect(calls[0].m).toBe("sendMessage");
    expect(calls[0].p.text).toContain("شام برو");
    // the chat model changes to Nova afterwards, and Telegram sends an edit: the connection's model must NOT follow
    await handleBusinessConnection(api, BC({ rights: { can_reply: true } }), { db, audience: all, activeModel: async () => "coder" });
    const c = (await getConnection("bc1", db))!;
    expect(c.model).toBe("sham_v2");
    expect(c.rights).toEqual({ can_reply: true });
  });

  it("the model changes only with an explicit confirmation and only by the connection's owner", async () => {
    const db = fakeDb(); const { api } = fakeApi();
    await handleBusinessConnection(api, BC(), { db, audience: all, activeModel: async () => "coder" });
    await expect(setConnectionModel(5001, "bc1", "sham_v2", undefined, db)).rejects.toThrow("confirmation");
    await expect(setConnectionModel(6000, "bc1", "sham_v2", true, db)).rejects.toThrow("not your");
    await expect(setConnectionModel(5001, "bc1", "gpt", true, db)).rejects.toThrow("unknown model");
    await setConnectionModel(5001, "bc1", "sham_v2", true, db);
    expect((await getConnection("bc1", db))!.model).toBe("sham_v2");
  });

  it("replies through business_connection_id with the chosen model, logs the model, and reads history from that model only", async () => {
    const db = fakeDb(); const { api, calls } = fakeApi();
    await handleBusinessConnection(api, BC(), { db, audience: all, activeModel: async () => "coder" });
    const seen: any[] = [];
    const generate = async (model: any, _s: string, history: any[], incoming: string) => { seen.push({ model, history, incoming }); return `reply by ${model}`; };
    const r1 = await handleBusinessMessage(api, MSG("hello"), { db, audience: all, deny: noDeny, generate });
    expect(r1.result).toBe("replied");
    const send = calls.filter((c) => c.m === "sendMessage" && c.p.business_connection_id);
    expect(send[0].p).toEqual({ business_connection_id: "bc1", chat_id: 9001, text: "reply by coder" });
    expect(calls.some((c) => c.m === "readBusinessMessage")).toBe(true);
    // switch to Sham Pro: its history starts empty (Nova's turns are not handed over)
    await setConnectionModel(5001, "bc1", "sham_v2", true, db);
    await handleBusinessMessage(api, MSG("second"), { db, audience: all, deny: noDeny, generate });
    expect(seen[1].model).toBe("sham_v2");
    expect(seen[1].history).toEqual([]);
    const act = await activityOf(5001, "bc1", db);
    expect(act.filter((a) => a.dir === "out").map((a) => a.model).sort()).toEqual(["coder", "sham_v2"]);
  });

  it("checks the can_reply right before sending", async () => {
    const db = fakeDb(); const { api, calls } = fakeApi();
    await handleBusinessConnection(api, BC({ rights: {} }), { db, audience: all, activeModel: async () => "coder" });
    let called = false;
    const r = await handleBusinessMessage(api, MSG("hi"), { db, audience: all, deny: noDeny, generate: async () => { called = true; return "x"; } });
    expect(r).toEqual({ result: "skipped", note: "no can_reply" });
    expect(called).toBe(false);
    expect(calls.some((c) => c.p?.business_connection_id && c.m === "sendMessage")).toBe(false);
  });

  it("no fallback: a failed model sends nothing to the contact and tells the user once", async () => {
    const db = fakeDb(); const { api, calls } = fakeApi();
    await handleBusinessConnection(api, BC(), { db, audience: all, activeModel: async () => "sham_v2" });
    const models: string[] = [];
    const r = await handleBusinessMessage(api, MSG("hi"), { db, audience: all, deny: noDeny, generate: async (m) => { models.push(m); return null; } });
    expect(r.result).toBe("failed");
    expect(models).toEqual(["sham_v2"]);
    expect(calls.some((c) => c.m === "sendMessage" && c.p.business_connection_id)).toBe(false);
    expect(calls.filter((c) => c.m === "sendMessage" && c.p.chat_id === 5001).pop()!.p.text).toContain("لا يُستخدم نموذج آخر");
  });

  it("the owner's switch gates everything; own messages are context, never answered", async () => {
    const db = fakeDb(); const { api } = fakeApi();
    await handleBusinessConnection(api, BC(), { db, audience: all, activeModel: async () => "coder" });
    const gen = async () => "x";
    expect((await handleBusinessMessage(api, MSG("hi"), { db, audience: async () => "off", deny: noDeny, generate: gen })).note).toBe("feature off");
    expect((await handleBusinessMessage(api, MSG("my own", { from: { id: 5001 } }), { db, audience: all, deny: noDeny, generate: gen })).note).toBe("own message");
    expect((await handleBusinessMessage(api, MSG("bot", { from: { id: 77, is_bot: true } }), { db, audience: all, deny: noDeny, generate: gen })).note).toBe("from a bot");
  });

  it("the owner's deny-list applies to users' accounts (incoming and the reply)", async () => {
    const db = fakeDb(); const { api, calls } = fakeApi();
    await handleBusinessConnection(api, BC(), { db, audience: all, activeModel: async () => "coder" });
    const r = await handleBusinessMessage(api, MSG("please rm -rf /"), { db, audience: all, deny: async () => ["rm -rf"], generate: async () => "ok" });
    expect(r.result).toBe("skipped");
    const r2 = await handleBusinessMessage(api, MSG("fine"), { db, audience: all, deny: async () => ["secret-word"], generate: async () => "the secret-word is" });
    expect(r2.result).toBe("skipped");
    expect(calls.some((c) => c.m === "sendMessage" && c.p.business_connection_id)).toBe(false);
  });

  it("each user sees and deletes only their own connections and log", async () => {
    const db = fakeDb(); const { api } = fakeApi();
    await handleBusinessConnection(api, BC(), { db, audience: all, activeModel: async () => "coder" });
    await handleBusinessConnection(api, BC({ id: "bc2", user: { id: 6000 }, user_chat_id: 6000 }), { db, audience: all, activeModel: async () => "coder" });
    expect((await connectionsOf(5001, db)).map((c) => c.id)).toEqual(["bc1"]);
    await expect(forgetConnection(5001, "bc2", db)).rejects.toThrow("not your");
    await forgetConnection(5001, "bc1", db);
    expect(await connectionsOf(5001, db)).toEqual([]);
    expect((await connectionsOf(6000, db)).length).toBe(1);
  });

  it("a disconnect is stored (paused) and nothing is sent afterwards", async () => {
    const db = fakeDb(); const { api, calls } = fakeApi();
    await handleBusinessConnection(api, BC(), { db, audience: all, activeModel: async () => "coder" });
    await handleBusinessConnection(api, BC({ is_enabled: false }), { db, audience: all, activeModel: async () => "coder" });
    expect(calls.pop()!.p.text).toContain("فصل");
    expect((await handleBusinessMessage(api, MSG("hi"), { db, audience: all, deny: noDeny, generate: async () => "x" })).note).toBe("paused");
  });
});

describe("Business replies by Sham Pro use Sham Pro's own native chat (generate_chat), not chat_memory (absent on sham-v2-server)", () => {
  it("defaultGenerate calls generate_chat on the v2 Studio with native turns and returns its text", async () => {
    const { defaultGenerate, businessShamTurns } = await import("@/lib/tgBusiness");
    process.env.MODELSCOPE_API_TOKEN = "t";
    process.env.SHAM_V2_OVERFLOW_URL = "off";
    const urls: string[] = [];
    const bodies: any[] = [];
    const real = global.fetch;
    global.fetch = (async (input: any, init?: any) => {
      urls.push(String(input));
      if (init?.body) bodies.push(JSON.parse(String(init.body)));
      if (String(input).includes("/call/v2/")) return { ok: true, status: 200, json: async () => ({ event_id: "e1" }) } as any;
      return { ok: true, status: 200, body: null, text: async () => 'event: complete\ndata: ["{\\"type\\": \\"text\\", \\"text\\": \\"أهلاً، سيرد صاحب الحساب قريباً.\\"}"]\n' } as any;
    }) as any;
    try {
      const out = await defaultGenerate("sham_v2", "RULES", [{ role: "user", text: "مرحبا" }, { role: "assistant", text: "أهلاً" }], "متى تفتحون؟", "biz:1");
      expect(out).toBe("أهلاً، سيرد صاحب الحساب قريباً.");
      expect(urls.some((u) => u.includes("/call/v2/generate_chat"))).toBe(true);
      expect(urls.some((u) => u.includes("chat_memory") || u.includes("generate_tldm"))).toBe(false);
      expect(urls.every((u) => u.includes("sham-v2"))).toBe(true);
      const turns = JSON.parse(bodies[0].messages_json);
      expect(turns.map((t: any) => t.role)).toEqual(["user", "assistant", "user"]);
      expect(turns[2].content).toContain("RULES");
      expect(turns[2].content).toContain("متى تفتحون؟");
    } finally {
      global.fetch = real;
      delete process.env.MODELSCOPE_API_TOKEN;
      delete process.env.SHAM_V2_OVERFLOW_URL;
    }
    expect(businessShamTurns("R", [{ role: "assistant", text: "x" }, { role: "user", text: "a" }, { role: "user", text: "b" }], "c").map((t) => t.role)).toEqual(["user"]);
  });
});
