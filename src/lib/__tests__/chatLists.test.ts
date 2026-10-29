// Per-model chat lists (Nova, Sham, Sham v2), against a real SQL engine: new chat, open an old chat with its full history, rename, pin, archive,
// delete (one / many / old / archived / all), search, isolation between models and between users.
import { shamVariant } from "@/lib/shamStudio";
import * as S from "@/lib/shamThreads";
import * as N from "@/lib/coderThreads";
import { forgetFacts, forgetMemory, loadMemory, saveTurn } from "@/lib/shamMemory";
import { pgDb } from "./pgDb";

const U = 7001, V = 7002;
const asV = <T,>(v: "v1" | "v2", f: () => Promise<T>) => shamVariant.run(v, f);
beforeEach(() => { process.env.SHAM_MEMORY = "1"; process.env.CODER_TOKEN_KEY = "test-key"; });

describe("Sham chat list", () => {
  it("each Sham has its own list; a chat of one is invisible to the other and to other users", async () => {
    const db: any = pgDb();
    await asV("v1", () => S.saveChatTurn(U, "سؤال شام الأول", "جواب شام الأول", db));
    await asV("v2", () => S.saveChatTurn(U, "سؤال شام الثاني", "جواب شام الثاني", db));
    await asV("v2", () => S.saveChatTurn(V, "سؤال مستخدم آخر", "جواب", db));
    const l1 = await S.listThreads(U, "v1", {}, db), l2 = await S.listThreads(U, "v2", {}, db), l3 = await S.listThreads(V, "v1", {}, db);
    expect(l1.map((t) => t.title)).toEqual(["سؤال شام الأول"]);
    expect(l2.map((t) => t.title)).toEqual(["سؤال شام الثاني"]);
    expect(l3).toEqual([]);
    expect(await S.openThread(U, "v1", l2[0].id, db)).toBe(false);          // v2's chat cannot be opened as v1
    expect(await S.openThread(V, "v2", l2[0].id, db)).toBe(false);          // nor by another user
  });

  it("does not fall back to shared history when variant-scoped memory cannot be read or written", async () => {
    const execCalls: string[] = [];
    const db: any = {
      exec: async (sql: string) => { execCalls.push(sql); throw new Error("database unavailable"); },
      query: async () => { throw new Error("database unavailable"); },
    };
    await expect(asV("v2", () => S.loadChatMemory(U, "سؤال شام v2", db))).resolves.toBeNull();
    await expect(asV("v2", () => S.saveChatTurn(U, "سؤال شام v2", "جواب شام v2", db))).resolves.toBeUndefined();
    expect(execCalls.some((sql) => /INSERT INTO sham_chat_memory/i.test(sql))).toBe(false);
  });

  it("user facts and Studio memory keys are isolated between Sham v1 and Sham v2", async () => {
    const db: any = pgDb();
    await asV("v1", () => S.saveChatTurn(U, "اسمي أحمد", "تم حفظ الاسم", db));
    await asV("v2", () => S.saveChatTurn(U, "اسمي ليلى", "تم حفظ الاسم", db));

    const v1 = await asV("v1", () => S.loadChatMemory(U, "ما اسمي؟", db));
    const v2 = await asV("v2", () => S.loadChatMemory(U, "ما اسمي؟", db));
    expect(v1?.facts.name).toBe("أحمد");
    expect(v2?.facts.name).toBe("ليلى");
    expect(v1?.chatKey).toContain("|v1");
    expect(v2?.chatKey).toContain("|v2");
    expect(v1?.chatKey).not.toBe(v2?.chatKey);

    expect(await forgetFacts(U, db, "v1")).toBe(true);
    expect((await asV("v1", () => S.loadChatMemory(U, "ما اسمي؟", db)))?.facts.name).toBeUndefined();
    expect((await asV("v2", () => S.loadChatMemory(U, "ما اسمي؟", db)))?.facts.name).toBe("ليلى");
    expect((await S.listThreads(U, "v1", {}, db))[0].title).toBe("اسمي أحمد");
    expect((await S.listThreads(U, "v2", {}, db))[0].title).toBe("اسمي ليلى");
  });

  it("a new chat starts empty; opening an old one brings back its full history; the other chat is not mixed in", async () => {
    const db: any = pgDb();
    await asV("v2", async () => {
      await S.saveChatTurn(U, "اسمي أحمد وأريد مساعدة في الرياضيات", "أهلاً أحمد", db);
      await S.saveChatTurn(U, "ما مجموع ٢ و٣؟", "٥", db);
    });
    const first = (await S.listThreads(U, "v2", {}, db))[0];
    expect(first.turns).toBe(2);
    const fresh = await S.newThread(U, "v2", db);
    expect(fresh).not.toBe(first.id);
    await asV("v2", async () => {
      const m = await S.loadChatMemory(U, "مرحبا", db);
      expect(m?.history).toEqual([]);                                       // a new chat has no earlier turns…
      expect(m?.facts.name).toBe("أحمد");                                   // …but what the user told Sham about themselves is still known
      await S.saveChatTurn(U, "اكتب لي قصيدة", "قصيدة…", db);
    });
    expect(await S.openThread(U, "v2", first.id, db)).toBe(true);           // «تابع المحادثة السابقة»
    await asV("v2", async () => {
      const m = await S.loadChatMemory(U, "وماذا بعد؟", db);
      expect(m?.history.map((t) => t.q)).toEqual(["اسمي أحمد وأريد مساعدة في الرياضيات", "ما مجموع ٢ و٣؟"]);
      expect(m?.history.map((t) => t.a)).toEqual(["أهلاً أحمد", "٥"]);        // replies come back too: the chat continues where it stopped
    });
    const msgs = await S.threadMessages(U, "v2", first.id, 200, db);
    expect(msgs?.map((t) => t.q)).toEqual(["اسمي أحمد وأريد مساعدة في الرياضيات", "ما مجموع ٢ و٣؟"]);
  });

  it("a reopened chat is continuous however long ago it was (no 90-minute session cut)", async () => {
    const db: any = pgDb();
    await asV("v1", () => S.saveChatTurn(U, "سؤال قديم", "جواب قديم", db));
    const t = (await S.listThreads(U, "v1", {}, db))[0];
    await db.exec(`UPDATE sham_chat_memory SET created_at = now() - interval '9 days' WHERE chat_key LIKE '%' || $1`, t.id);
    await db.exec(`UPDATE sham_threads SET updated_at = now() - interval '9 days' WHERE id = $1`, t.id);
    await asV("v1", async () => expect((await S.loadChatMemory(U, "تكملة", db))?.history.map((h) => h.q)).toEqual(["سؤال قديم"]));
  });

  it("rename, pin (goes first), archive (hidden, then listed under archived, opening restores it)", async () => {
    const db: any = pgDb();
    const ids: string[] = [];
    for (const q of ["أولى", "ثانية", "ثالثة"]) { await asV("v1", () => S.saveChatTurn(U, q, "رد " + q, db)); ids.push((await S.listThreads(U, "v1", {}, db))[0].id); await S.newThread(U, "v1", db); }
    const unique = [...new Set(ids)];
    expect(unique).toHaveLength(3);
    expect((await S.listThreads(U, "v1", {}, db)).map((t) => t.title)).toEqual(["ثالثة", "ثانية", "أولى"]);
    expect(await S.pinThread(U, "v1", unique[0], true, db)).toBe(true);
    expect((await S.listThreads(U, "v1", {}, db))[0].title).toBe("أولى");
    expect(await S.renameThread(U, "v1", unique[1], "  عنوان جديد  ", db)).toBe(true);
    expect(await S.renameThread(U, "v1", unique[1], "   ", db)).toBe(false);
    expect(await S.archiveThread(U, "v1", unique[1], true, db)).toBe(true);
    expect((await S.listThreads(U, "v1", {}, db)).map((t) => t.title)).not.toContain("عنوان جديد");
    expect((await S.listThreads(U, "v1", { archived: "only" }, db)).map((t) => t.title)).toEqual(["عنوان جديد"]);
    expect(await S.listThreads(U, "v1", { archived: "include" }, db)).toHaveLength(3);
    expect(await S.openThread(U, "v1", unique[1], db)).toBe(true);
    expect((await S.listThreads(U, "v1", {}, db)).map((t) => t.title)).toContain("عنوان جديد");
  });

  it("search finds a chat by its title or by something said inside it, in this Sham only", async () => {
    const db: any = pgDb();
    await asV("v1", () => S.saveChatTurn(U, "كيف أطبخ الكبسة", "ضع الأرز واللحم", db)); await S.newThread(U, "v1", db);
    await asV("v1", () => S.saveChatTurn(U, "ما عاصمة فرنسا", "باريس هي العاصمة", db)); await S.newThread(U, "v1", db);
    await asV("v2", () => S.saveChatTurn(U, "الكبسة في شام ٢", "نعم", db));
    expect((await S.listThreads(U, "v1", { q: "الكبسة" }, db)).map((t) => t.title)).toEqual(["كيف أطبخ الكبسة"]);
    expect((await S.listThreads(U, "v1", { q: "باريس" }, db)).map((t) => t.title)).toEqual(["ما عاصمة فرنسا"]);   // inside the reply
    expect(await S.listThreads(U, "v1", { q: "لا شيء هنا" }, db)).toEqual([]);
    expect((await S.listThreads(U, "v1", { q: "100%_" }, db))).toEqual([]);                                       // wildcards are literal
  });

  it("delete one / many / old / archived / all: turns are really erased; pinned and the open chat survive sweeps", async () => {
    const db: any = pgDb();
    const mk = async (q: string) => { await asV("v1", () => S.saveChatTurn(U, q, "رد " + q, db)); const id = (await S.listThreads(U, "v1", {}, db)).find((t) => t.title === q)!.id; await S.newThread(U, "v1", db); return id; };
    const a = await mk("a1"), b = await mk("b1"), c = await mk("c1"), d = await mk("d1"), e = await mk("e1");
    expect(await S.deleteThreads(U, "v1", { ids: [a] }, db)).toEqual([a]);
    expect(await S.threadMessages(U, "v1", a, 10, db)).toBeNull();
    expect((await db.query(`SELECT count(*)::int AS n FROM sham_chat_memory WHERE chat_key LIKE '%' || $1`, a))[0].n).toBe(0);
    expect(await S.openThread(U, "v1", a, db)).toBe(false);
    expect((await S.deleteThreads(U, "v1", { ids: [b, c] }, db)).sort()).toEqual([b, c].sort());
    await S.pinThread(U, "v1", d, true, db);
    await db.exec(`UPDATE sham_threads SET updated_at = now() - interval '40 days' WHERE id = ANY($1::text[])`, [d, e]);
    expect(await S.deleteThreads(U, "v1", { olderThanDays: 30 }, db)).toEqual([e]);                 // d is pinned
    await S.archiveThread(U, "v1", d, true, db);                                                      // (archiving unpins)
    expect(await S.deleteThreads(U, "v1", { archived: true }, db)).toEqual([d]);
    await asV("v1", () => S.saveChatTurn(U, "x", "y", db));
    const x = (await S.listThreads(U, "v1", {}, db)).map((t) => t.id);
    expect(x).toHaveLength(1);
    expect(await S.deleteThreads(U, "v1", { all: true }, db)).toEqual([]);                           // the open chat is spared
    expect(await S.deleteThreads(U, "v1", {}, db)).toEqual([]);                                       // nothing named, nothing deleted
    expect(await S.deleteThreads(U, "v1", { ids: x }, db)).toEqual(x);                                // but may be named
    await asV("v1", async () => expect((await S.loadChatMemory(U, "hi", db))?.history).toEqual([]));    // a fresh chat is made on the next message
  });

  it("deleting a chat of one Sham never touches the other's", async () => {
    const db: any = pgDb();
    await asV("v1", () => S.saveChatTurn(U, "s1", "r1", db)); await asV("v2", () => S.saveChatTurn(U, "s2", "r2", db));
    await S.deleteThreads(U, "v1", { all: true, ids: (await S.listThreads(U, "v1", {}, db)).map((t) => t.id) }, db);
    expect((await S.listThreads(U, "v2", {}, db)).map((t) => t.title)).toEqual(["s2"]);
  });

  it("«انسَ معلوماتي» clears the chats too; memory off stores nothing and creates nothing visible", async () => {
    const db: any = pgDb();
    await asV("v1", () => S.saveChatTurn(U, "اسمي سامي", "تشرفنا", db));
    expect(await S.listThreads(U, "v1", {}, db)).toHaveLength(1);
    expect(await forgetMemory(U, db)).toBe(true);
    expect(await S.listThreads(U, "v1", {}, db)).toEqual([]);
    expect((await db.query(`SELECT count(*)::int AS n FROM sham_chat_memory`))[0].n).toBe(0);
    process.env.SHAM_MEMORY = "off";
    await asV("v1", () => S.saveChatTurn(U, "لن يحفظ", "أبداً", db));
    expect((await db.query(`SELECT count(*)::int AS n FROM sham_chat_memory`))[0].n).toBe(0);
    expect(await asV("v1", () => S.loadChatMemory(U, "x", db))).toBeNull();
  });

  it("the old single stream (no chat list) still works the same: no scope = the per-user key", async () => {
    const db: any = pgDb();
    await saveTurn(U, "قديم", "جواب", db);
    expect((await loadMemory(U, "جديد", db))?.history.map((t) => t.q)).toEqual(["قديم"]);
  });
});

describe("Nova chat list (coder_threads)", () => {
  async function seed(db: any, titles: string[]) {
    const out: string[] = [];
    for (const t of titles) out.push(await N.createThread(U, { title: t, messages: [{ role: "user", content: t }, { role: "assistant", content: "رد على " + t + " كلمة_سرية_" + t }] as any }, db));
    return out;
  }
  it("list: newest first, pinned first, archived hidden, search in title and in the conversation", async () => {
    const db: any = pgDb();
    const [a, b, c] = await seed(db, ["مشروع الموقع", "إصلاح الخطأ", "خطة الأسبوع"]);
    expect((await N.listThreads(U, {}, db)).map((t) => t.id)).toEqual([c, b, a]);
    await N.pinThread(U, a, true, db);
    expect((await N.listThreads(U, {}, db))[0].id).toBe(a);
    await N.archiveThread(U, b, true, db);
    expect((await N.listThreads(U, {}, db)).map((t) => t.id)).toEqual([a, c]);
    expect((await N.listThreads(U, { archived: "only" }, db)).map((t) => t.id)).toEqual([b]);
    expect((await N.listThreads(U, { q: "الخطأ" }, db)).map((t) => t.id)).toEqual([]);                    // archived are not in the default search
    expect((await N.listThreads(U, { q: "الخطأ", archived: "include" }, db)).map((t) => t.id)).toEqual([b]);
    expect((await N.listThreads(U, { q: "كلمة_سرية_خطة" }, db)).map((t) => t.id)).toEqual([c]);            // inside the conversation
    expect(await N.listThreads(V, {}, db)).toEqual([]);                                                    // another user sees nothing
  });
  it("bulk delete (hidden, kept): ids / old / archived / all; pinned and the open one are spared by sweeps", async () => {
    const db: any = pgDb();
    const [a, b, c, d, e] = await seed(db, ["1", "2", "3", "4", "5"]);
    expect((await N.hideThreads(U, { ids: [a, b] }, db)).sort()).toEqual([a, b].sort());
    await N.pinThread(U, c, true, db);
    await db.exec(`UPDATE coder_threads SET updated_at = now() - interval '60 days' WHERE id = ANY($1::text[])`, [c, d]);
    expect(await N.hideThreads(U, { olderThanDays: 30 }, db)).toEqual([d]);
    await N.archiveThread(U, c, true, db);
    expect(await N.hideThreads(U, { archived: true }, db)).toEqual([c]);
    expect(await N.hideThreads(U, { all: true, keepId: e }, db)).toEqual([]);
    expect(await N.hideThreads(U, {}, db)).toEqual([]);
    expect(await N.hideThreads(V, { ids: [e] }, db)).toEqual([]);                                          // not another user's
    expect(await N.hideThreads(U, { all: true }, db)).toEqual([e]);
    expect(await N.listThreads(U, { archived: "include" }, db)).toEqual([]);
  });
  it("transcript of a chat: plain user/assistant text, hidden ones are gone", async () => {
    const db: any = pgDb();
    const [a] = await seed(db, ["موضوع"]);
    expect((await N.threadTranscript(U, a, 60, db))?.map((m) => m.role)).toEqual(["user", "assistant"]);
    await N.hideThreads(U, { ids: [a] }, db);
    expect(await N.threadTranscript(U, a, 60, db)).toBeNull();
  });
});
