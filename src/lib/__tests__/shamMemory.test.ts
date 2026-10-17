import { chatKey, currentSession, relatedEarlier, extractFacts, foldSummary, forgetMemory, loadMemory, saveTurn, WINDOW_TURNS, SUMMARY_EVERY, type Db } from "@/lib/shamMemory";
import { shamChatMemory, shamMemoryForget } from "@/lib/shamStudio";

// a tiny in-memory stand-in for the two tables, answering exactly the SQL shamMemory.ts sends
function fakeDb() {
  const turns: { id: number; chat_key: string; question: string; answer: string }[] = [];
  const profs = new Map<string, { facts: string; summary: string; summarized_upto: number }>();
  let seq = 0;
  const db: Db = {
    exec: async (sql: string, ...a: any[]) => {
      if (sql.startsWith("INSERT INTO sham_chat_memory")) turns.push({ id: ++seq, chat_key: a[0], question: a[1], answer: a[2] });
      else if (sql.startsWith("INSERT INTO sham_user_facts")) profs.set(a[0], { facts: a[1], summary: a[2], summarized_upto: a[3] });
      else if (sql.startsWith("DELETE FROM sham_chat_memory")) for (let i = turns.length - 1; i >= 0; i--) { if (turns[i].chat_key === a[0]) turns.splice(i, 1); }
      else if (sql.startsWith("DELETE FROM sham_user_facts")) profs.delete(a[0]);
      return 0;
    },
    query: async <T,>(sql: string, ...a: any[]): Promise<T[]> => {
      if (sql.includes("FROM sham_user_facts")) { const p = profs.get(a[0]); return (p ? [p] : []) as T[]; }
      const mine = turns.filter((t) => t.chat_key === a[0]).sort((x, y) => y.id - x.id);
      if (sql.includes("OFFSET")) return mine.filter((t) => t.id > Number(a[1])).slice(WINDOW_TURNS) as T[];
      return mine.slice(0, WINDOW_TURNS) as T[];
    },
  };
  return { db, turns, profs };
}

describe("shamMemory", () => {
  it("extracts facts in natural Arabic and ignores questions", () => {
    expect(extractFacts("مرحبا، اسمي سامر وأنا من حلب وعمري 30")).toEqual({ name: "سامر", city: "حلب", age: "30" });
    expect(extractFacts("ما اسمي؟")).toEqual({});
    expect(extractFacts("my name is Omar")).toEqual({ name: "Omar" });
  });
  it("hashes the chat id (never stored raw) and keeps users apart", () => {
    expect(chatKey(123)).toMatch(/^tg:[0-9a-f]{32}$/);
    expect(chatKey(123)).not.toContain("123");
    expect(chatKey(123)).not.toBe(chatKey(124));
  });
  it("folds old turns into a bounded rolling summary", () => {
    const s = foldSummary("", [{ q: "أريد وصفة كبسة دجاج سهلة", a: "..." }, { q: "وكم تحتاج من الوقت؟", a: "..." }]);
    expect(s).toContain("كبسة") && expect(s).toContain(" | ");
    let big = "";
    for (let i = 0; i < 200; i++) big = foldSummary(big, [{ q: `موضوع رقم ${i} عن شيء طويل نسبياً`, a: "" }]);
    expect(big.length).toBeLessThanOrEqual(600);
    expect(big).toContain("رقم 199");
  });
  it("keeps a sliding window, facts, a summary, separate users, and forgets", async () => {
    const { db, turns } = fakeDb();
    await saveTurn(1, "اسمي سامر وأنا من حلب", "أهلاً سامر", db);
    for (let i = 0; i < WINDOW_TURNS + SUMMARY_EVERY + 2; i++) await saveTurn(1, `سؤال عن الموضوع ${i}`, `جواب ${i}`, db);
    const m = await loadMemory(1, "ما اسمي؟", db);
    expect(m?.history.length).toBe(WINDOW_TURNS);
    expect(m?.history[WINDOW_TURNS - 1].q).toBe(`سؤال عن الموضوع ${WINDOW_TURNS + SUMMARY_EVERY + 1}`);   // oldest first, newest last
    expect(m?.facts).toEqual({ name: "سامر", city: "حلب" });
    expect(m?.summary).toBe("");                                      // unrelated older questions are no longer replayed as a summary
    const other = await loadMemory(2, "ما اسمي؟", db);
    expect(other?.history).toEqual([]) ; expect(other?.facts).toEqual({}); expect(other?.summary).toBe("");
    expect((await loadMemory(1, "اسمي ليلى", db))?.facts.name).toBe("ليلى");                     // this message's facts win
    await saveTurn(2, "مرحبا", "أهلاً", db);
    expect(await forgetMemory(1, db)).toBe(true);
    const after = await loadMemory(1, "ما اسمي؟", db);
    expect(after?.history).toEqual([]); expect(after?.facts).toEqual({});
    expect(turns.filter((t) => t.chat_key === chatKey(2)).length).toBe(1);                         // the other user is untouched
  });
  it("is off with SHAM_MEMORY=0 and sends nothing without a token", async () => {
    process.env.SHAM_MEMORY = "0";
    expect(await loadMemory(1, "x", fakeDb().db)).toBeNull();
    delete process.env.SHAM_MEMORY;
    delete process.env.MODELSCOPE_API_TOKEN;
    expect(await shamChatMemory("مرحبا", { userId: "tg:x", history: [], summary: "", facts: {} })).toBeNull();
    expect(await shamMemoryForget("tg:x")).toBe(false);
  });

  it("replays only the current conversation, and old questions only when related", () => {
    const now = Date.parse("2026-10-17T12:00:00Z");
    const mk = (min: number, q: string) => ({ question: q, answer: "ج", created_at: new Date(now - min * 60_000).toISOString() });
    const rows = [mk(5, "سؤال حديث"), mk(20, "سؤال قبله"), mk(60 * 30, "أريد وصفة كبسة دجاج سهلة"), mk(60 * 31, "ما هو الطقس")];
    const { current, older } = currentSession(rows, now);
    expect(current.map((r) => r.question)).toEqual(["سؤال حديث", "سؤال قبله"]);
    expect(older.length).toBe(2);
    const t = older.map((r) => ({ q: r.question, a: r.answer }));
    expect(relatedEarlier("كيف أطبخ كبسة دجاج؟", t)).toContain("وصفة كبسة دجاج");
    expect(relatedEarlier("ما عاصمة فرنسا؟", t)).toBe("");
  });

  it("takes facts from statements, not from questions or loose phrases", () => {
    expect(extractFacts("هل أحب القهوة؟")).toEqual({});
    expect(extractFacts("أحب أن أسألك عن أشياء كثيرة")).toEqual({});
    expect(extractFacts("أحب القهوة").likes).toBe("القهوة");
  });
});
