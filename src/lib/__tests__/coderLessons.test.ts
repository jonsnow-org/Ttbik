import { buildLesson, recordLesson, exportLessons, lessonStats, clearLessons } from "@/lib/coderLessons";
import { DEFAULT_MODELS, chooseModel } from "@/lib/coderModels";
import { appOp, AppError } from "@/lib/coderApp";
import { fakeBot, fakeDb } from "./coderFakes";

const call = (id: string, name: string, args: object) => ({ id, type: "function" as const, function: { name, arguments: JSON.stringify(args) } });
const research: any[] = [
  { role: "system", content: "SYSTEM PROMPT never kept" },
  { role: "user", content: "ابحث عن مشاريع بوتات تلجرام وكيف تتعامل مع الانقطاع" },
  { role: "assistant", content: "", tool_calls: [call("a1", "deep_research", { question: "x" })] },
  { role: "tool", tool_call_id: "a1", name: "deep_research", content: "[1] awesome-telegram-ai-bots: queues and retries ".repeat(80) },
  { role: "user", content: "[harness] write the report now" },
  { role: "assistant", content: "التقرير: أغلب المشاريع تستعمل طوابير وإعادة محاولة مع تأخر متزايد عند خطأ 429 في تلجرام، وتقسّم الرسائل الطويلة قبل 4096 حرفاً [1]." },
];

describe("lessons: the owner's successful runs as training examples", () => {
  it("keeps research with its sources, drops the system prompt and the engine's nudges, shortens tool results", () => {
    const l = buildLesson("r1", 3, research)!;
    expect(l.kind).toBe("research");
    expect(l.messages.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant"]);
    expect(JSON.stringify(l.messages)).not.toMatch(/SYSTEM PROMPT|\[harness\]/);
    expect((l.messages[2] as any).content.length).toBeLessThanOrEqual(1500);
  });
  it("a run that shows anything secret-looking is not kept at all; short or answerless runs are not kept", () => {
    for (const leak of ["ghp_" + "a".repeat(30), "github_pat_" + "B".repeat(30), "token: abcd1234efgh5678", "123456789:" + "A".repeat(35), "x".repeat(70) + "==", "-----BEGIN RSA PRIVATE KEY-----"]) {
      expect(buildLesson("r", 1, [...research.slice(0, 5), { role: "user", content: `خذ هذا ${leak}` }, research[5]])).toBeNull();
    }
    expect(buildLesson("r", 1, [{ role: "user", content: "مرحبا" }, { role: "assistant", content: "أهلاً" }])).toBeNull();
    expect(buildLesson("r", 1, [{ role: "user", content: "سؤال" }])).toBeNull();
    expect(buildLesson("r", 1, [{ role: "user", content: "اشرح لي بالتفصيل كيف تعمل الشبكات" }, { role: "assistant", content: "الشبكات ".repeat(30) }])!.kind).toBe("chat");
  });
  it("records once per run, counts by kind, exports JSON Lines, can be cleared, and is off with CODER_LESSONS=off", async () => {
    const db: any = fakeDb();
    const rows = new Map<string, any>();
    db.exec = async (sql: string, ...a: any[]) => { if (sql.includes("INSERT INTO coder_lessons") && !rows.has(a[0])) rows.set(a[0], { run_id: a[0], kind: a[1], steps: a[2], messages: JSON.parse(a[3]) }); if (sql.includes("DELETE FROM coder_lessons")) rows.clear(); };
    db.query = async (sql: string) => (sql.includes("GROUP BY kind") ? [...[...rows.values()].reduce((m, r) => m.set(r.kind, (m.get(r.kind) || 0) + 1), new Map<string, number>())].map(([kind, n]) => ({ kind, n })) : sql.includes("FROM coder_lessons") ? [...rows.values()] : []);
    expect(await recordLesson("r1", 3, research, db)).toBe(true);
    await recordLesson("r1", 3, research, db);
    expect((await lessonStats(db))).toEqual({ total: 1, byKind: { research: 1 } });
    const ex = await exportLessons(db);
    expect(ex.count).toBe(1);
    expect(JSON.parse(ex.jsonl.split("\n")[0])).toMatchObject({ kind: "research", run: "r1" });
    process.env.CODER_LESSONS = "off";
    expect(await recordLesson("r2", 1, research, db)).toBe(false);
    delete process.env.CODER_LESSONS;
    await clearLessons(db);
    expect((await lessonStats(db)).total).toBe(0);
  });
  it("only the owner can read, export or clear lessons", async () => {
    const db = fakeDb();
    const { bot } = fakeBot();
    process.env.SUPER_ADMIN_TELEGRAM_ID = "4242";
    await expect(appOp({ chatId: 9001, tier: "user" }, "lessons", {}, { db, bot, botRow: { id: "b" } as any })).rejects.toBeInstanceOf(AppError);
  });
});

describe("Sham inside Nova's engine (owner only)", () => {
  it("the picker offers 'Sham (advanced)' to the owner only and only when Sham's Studio token exists", () => {
    const m = DEFAULT_MODELS.find((x) => x.id === "sham")!;
    expect(m).toMatchObject({ ownerOnly: true, visible: false });
    const st: any = { mode: "coder" };
    delete process.env.MODELSCOPE_API_TOKEN;
    expect(chooseModel(st, DEFAULT_MODELS, "sham", true)).toBe(false);          // no token: cannot be chosen
    process.env.MODELSCOPE_API_TOKEN = "ms";
    expect(chooseModel(st, DEFAULT_MODELS, "sham", false)).toBe(false);         // a user: never
    expect(chooseModel(st, DEFAULT_MODELS, "sham", true)).toBe(true);
    expect([st.model, st.mode]).toEqual(["sham", "sham"]);                      // stays in the engine (the legacy 'sham' still goes to the old path)
  });
});
