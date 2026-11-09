// Sham's automatic knowledge: what it reads while searching is kept with source and date, found again by words (Arabic-normalised BM25), per user and model, bounded.
import { chunkText, knowledgeCount, knowledgeSave, knowledgeSearch, normaliseText, tokens } from "@/lib/shamKnowledge";
import { setShamHost, shamRunTool, type ShamCtx, type ShamHost } from "@/lib/shamExec";

type Row = { id: number; chat_key: string; hash: string; source: string; url: string; title: string; body: string; norm: string; saved_at: Date };
function memDb() {
  const rows: Row[] = [];
  let id = 0;
  return {
    rows,
    exec: async (sql: string, ...a: any[]) => {
      if (/^INSERT INTO sham_knowledge/.test(sql)) rows.push({ id: ++id, chat_key: a[0], hash: a[1], source: a[2], url: a[3], title: a[4], body: a[5], norm: a[6], saved_at: new Date("2026-11-09T00:00:00Z") });
      else if (/^DELETE FROM sham_knowledge/.test(sql)) { const n = a[1]; rows.splice(0, rows.length, ...rows.filter((r) => r.chat_key !== a[0]).concat(rows.filter((r) => r.chat_key === a[0]).slice(n))); }
    },
    query: async (sql: string, ...a: any[]) => {
      if (/SELECT id FROM sham_knowledge WHERE chat_key = \$1 AND hash/.test(sql)) return rows.filter((r) => r.chat_key === a[0] && r.hash === a[1]).map((r) => ({ id: r.id }));
      if (/SELECT count\(\*\)/.test(sql)) return [{ n: rows.filter((r) => r.chat_key === a[0]).length }];
      if (/SELECT id, source/.test(sql)) return rows.filter((r) => r.chat_key === a[0]).sort((x, y) => y.id - x.id);
      return [];
    },
  } as any;
}

const STORY = "وقعت معركة حطين في الرابع من يوليو سنة 1187م بين جيش صلاح الدين الأيوبي والصليبيين قرب طبريا في فلسطين. انتهت المعركة بانتصار المسلمين وأسر ملك القدس غي دي لوزينيان. وكانت هذه المعركة سبباً مباشراً لتحرير مدينة القدس بعد أشهر قليلة.";

describe("normalisation and chunks", () => {
  it("meets a question and a text: diacritics, alef/ya/ta-marbuta variants, the article and digits", () => {
    expect(normaliseText("الْقُدْسُ، أَوْ إِسْرَاءٌ؟")).toBe("القدس او اسراء");
    expect(tokens("معركةُ الحِطّين في ١١٨٧")).toEqual(["معركه", "حطين", "1187"]);
    expect(tokens("What is the Antikythera mechanism?")).toEqual(["antikythera", "mechanism"]);
  });
  it("cuts long text at sentence boundaries and drops fragments too short to mean anything", () => {
    const long = Array.from({ length: 30 }, (_, i) => `الجملة رقم ${i} تتحدث عن موضوع مهم جداً في التاريخ القديم.`).join(" ");
    const parts = chunkText(long);
    expect(parts.length).toBeGreaterThan(2);
    expect(parts.every((p) => p.length <= 1100)).toBe(true);
    expect(chunkText("نعم.")).toEqual([]);
  });
});

describe("save and search", () => {
  it("keeps what was read with source and date, finds it by a differently worded question, and skips a repeat", async () => {
    const db = memDb();
    expect(await knowledgeSave(db, "sham:1:v2", { source: "fetch_page", url: "https://ar.wikipedia.org/wiki/معركة_حطين", title: "معركة حطين", text: STORY })).toBe(1);
    expect(await knowledgeSave(db, "sham:1:v2", { source: "fetch_page", text: STORY })).toBe(0);            // the same chunk is not stored twice
    const out = await knowledgeSearch(db, "sham:1:v2", "من انتصر في حطين؟");
    expect(out).toContain("(fetch_page · معركة حطين · https://ar.wikipedia.org/wiki/معركة_حطين · saved 2026-11-09)");
    expect(out).toContain("صلاح الدين");
    expect(await knowledgeSearch(db, "sham:1:v2", "ما هي عاصمة اليابان")).toMatch(/^no saved text matches/);
  });
  it("is private per user and model, and says so when nothing was ever saved", async () => {
    const db = memDb();
    await knowledgeSave(db, "sham:1:v2", { source: "web_search", text: STORY });
    expect(await knowledgeSearch(db, "sham:2:v2", "حطين")).toMatch(/^nothing saved yet/);
    expect(await knowledgeSearch(db, "sham:1:v1", "حطين")).toMatch(/^nothing saved yet/);
    expect(await knowledgeCount(db, "sham:1:v2")).toBe(1);
  });
  it("never stores an error result and never throws", async () => {
    const db = memDb();
    expect(await knowledgeSave(db, "k", { source: "web_search", text: "error: timeout while reading the page" })).toBe(0);
    expect(await knowledgeSave({ exec: async () => { throw new Error("db down"); }, query: async () => { throw new Error("db down"); } } as any, "k", { source: "x", text: STORY })).toBe(0);
  });
});

describe("through the tools", () => {
  const call = (name: string, args: object) => ({ id: "1", type: "function", function: { name, arguments: JSON.stringify(args) } }) as any;
  it("a page read with fetch_page is kept automatically and knowledge_search finds it later", async () => {
    const db = memDb();
    setShamHost({
      web: { page: async () => ({ ok: true, url: "https://x.test/hittin", text: "# معركة حطين\nhttps://x.test/hittin\n\n" + STORY }), search: async () => "", request: async () => "", research: async () => "" },
      bank: { add: async () => undefined, recall: async () => "" },
    } as unknown as ShamHost);
    const ctx = { chatId: 1, db, githubToken: null, chatKey: "sham:1:v2", runId: "r", owner: false } as unknown as ShamCtx;
    await shamRunTool(call("fetch_page", { url: "https://x.test/hittin" }), ctx);
    await new Promise((r) => setTimeout(r, 20));                                  // the save is fire-and-forget
    expect(await knowledgeCount(db, "sham:1:v2")).toBeGreaterThan(0);
    const found = await shamRunTool(call("knowledge_search", { query: "حطين صلاح الدين" }), ctx);
    expect(found).toContain("معركة حطين");
    expect(found).toContain("fetch_page");
    setShamHost(null);
  });
});
