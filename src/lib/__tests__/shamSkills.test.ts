// Sham Pro's own skill file and self-review (owner 2026-11-26): the model claimed eight skills it had \"added\" and nothing was stored. A skill is a row
// it writes with skill_save, opens later with skill, and a review is numbers from its own tables — never an opinion about itself. Fake SQL engine, no DB.
import { cleanSkill, ensureSkillTable, isSelfDevelopmentRequest, listShamSkills, removeShamSkill, saveShamSkill, savedSkillText, savedSkillsNote, shamSelfReview, SHAM_SKILLS_MAX } from "@/lib/shamSkills";
import { shamTools } from "@/lib/shamExec";
import { shamVariant } from "@/lib/shamStudio";
import type { Db } from "@/lib/shamDb";

type SkillRow = { model: string; name: string; title: string; when_hint: string; steps: string; source_chat: string; uses: number };
type TurnRow = { chat_key: string; question: string; answer: string };

/** The few statements shamSkills.ts issues, answered from two arrays. `fail` makes every statement throw (a database that is down). */
function fakeDb(opts: { fail?: boolean } = {}) {
  const skills: SkillRow[] = [];
  const turns: TurnRow[] = [];
  const db = Object.assign(Object.create(null), {
    ddl: true,
    skills,
    turns,
    exec: async (sql: string, ...args: unknown[]) => {
      if (opts.fail) throw new Error("connection refused");
      const a = args as unknown[];
      if (sql.startsWith("CREATE")) return undefined;
      if (sql.startsWith("INSERT INTO sham_skills")) {
        const row: SkillRow = { model: String(a[0]), name: String(a[1]), title: String(a[2]), when_hint: String(a[3]), steps: String(a[4]), source_chat: String(a[5]), uses: 0 };
        const i = skills.findIndex((s) => s.model === row.model && s.name === row.name);
        if (i >= 0) skills[i] = { ...row, uses: skills[i].uses };
        else skills.push(row);
        return undefined;
      }
      if (sql.startsWith("DELETE FROM sham_skills")) {
        const i = skills.findIndex((s) => s.model === a[0] && s.name === a[1]);
        if (i >= 0) skills.splice(i, 1);
        return undefined;
      }
      if (sql.startsWith("UPDATE sham_skills")) {
        const s = skills.find((x) => x.model === a[0] && x.name === a[1]);
        if (s) s.uses++;
        return undefined;
      }
      return undefined;
    },
    query: async <T,>(sql: string, ...args: unknown[]): Promise<T[]> => {
      if (opts.fail) throw new Error("connection refused");
      const a = args as unknown[];
      if (sql.includes("FROM sham_skills WHERE model=$1 AND name=$2")) return skills.filter((s) => s.model === a[0] && s.name === a[1]) as T[];
      if (sql.includes("SELECT count(*) AS n FROM sham_skills")) return [{ n: skills.filter((s) => s.model === a[0]).length }] as T[];
      if (sql.includes("FROM sham_skills WHERE model=$1 ORDER BY")) return skills.filter((s) => s.model === a[0]).slice().reverse() as T[];
      if (sql.includes("FROM sham_chat_memory WHERE chat_key LIKE")) return [{ n: turns.length }] as T[];
      if (sql.includes("FROM sham_chat_memory WHERE chat_key=$1")) return turns.filter((t) => t.chat_key === a[0] || t.chat_key.startsWith(`${String(a[0])}|`)).map((t) => ({ question: t.question, answer: t.answer })) as T[];
      return [] as T[];
    },
  });
  return db as unknown as Db & { skills: SkillRow[]; turns: TurnRow[] };
}

const SKILL = { name: "quick_answer", title: "Answer in two lines", when: "the user asks a short factual question", steps: "1) web_search(query). 2) answer in the user's language, two lines, with the source." };

describe("Sham Pro writes its own skills", () => {
  it("accepts a real procedure and rejects a name or steps it cannot store", () => {
    expect(cleanSkill(SKILL)).toEqual({ ok: true, skill: { name: "quick_answer", title: "Answer in two lines", when: "the user asks a short factual question", steps: SKILL.steps } });
    expect(cleanSkill({ ...SKILL, name: "Quick Answer" })).toMatchObject({ ok: false });
    expect(cleanSkill({ ...SKILL, name: "سريع" })).toMatchObject({ ok: false });
    expect(cleanSkill({ ...SKILL, steps: "احفظ هذا" })).toMatchObject({ ok: false });
    expect(cleanSkill({ ...SKILL, steps: "x".repeat(2000) })).toMatchObject({ ok: false });
  });

  it("skill_save stores a row and says so; a second save updates the same skill instead of duplicating it", async () => {
    const db = fakeDb();
    const first = await saveShamSkill(db, "sham_v2", "chat:1", SKILL);
    expect(first).toContain("حُفظت المهارة «quick_answer»");
    expect(first).toContain("جديدة");
    expect(db.skills).toHaveLength(1);
    expect(db.skills[0]).toMatchObject({ model: "sham_v2", name: "quick_answer", title: "Answer in two lines" });
    const again = await saveShamSkill(db, "sham_v2", "chat:1", { ...SKILL, title: "Answer briefly" });
    expect(again).toContain("حُدِّثت");
    expect(db.skills).toHaveLength(1);
    expect(db.skills[0].title).toBe("Answer briefly");
  });

  it("no row, no claim: a database that is down returns an error line, never 'saved'", async () => {
    const out = await saveShamSkill(fakeDb({ fail: true }), "sham_v2", "chat:1", SKILL);
    expect(out).toMatch(/^error: لم يُحفظ شيء/);
  });

  it(`stops at ${SHAM_SKILLS_MAX} skills and says what to do`, async () => {
    const db = fakeDb();
    for (let i = 0; i < SHAM_SKILLS_MAX; i++) await saveShamSkill(db, "sham_v2", "chat:1", { ...SKILL, name: `s${i}` });
    expect(db.skills).toHaveLength(SHAM_SKILLS_MAX);
    const out = await saveShamSkill(db, "sham_v2", "chat:1", SKILL);
    expect(out).toMatch(/^error: .*الحد الأقصى.*skill_delete/);
  });

  it("a saved skill loads with skill() as the same SKILL text, counts its use, and appears in the prompt note", async () => {
    const db = fakeDb();
    await saveShamSkill(db, "sham_v2", "chat:1", SKILL);
    const text = await savedSkillText(db, "sham_v2", "quick_answer");
    expect(text).toContain("SKILL quick_answer");
    expect(text).toContain("Use when: the user asks a short factual question");
    expect(text).toContain("web_search(query)");
    await new Promise((r) => setTimeout(r, 0));
    expect(db.skills[0].uses).toBe(1);
    expect(await savedSkillText(db, "sham_v2", "unknown")).toBeNull();
    expect(await savedSkillsNote(db, "sham_v2")).toContain("quick_answer");
    // another model never sees it
    expect(await savedSkillText(db, "sham", "quick_answer")).toBeNull();
    expect(await savedSkillsNote(db, "sham")).toBe("");
  });

  it("skill_delete removes only a saved one", async () => {
    const db = fakeDb();
    await saveShamSkill(db, "sham_v2", "chat:1", SKILL);
    expect(await removeShamSkill(db, "sham_v2", "quick_answer")).toContain("حُذفت المهارة");
    expect(await listShamSkills(db, "sham_v2")).toEqual([]);
    expect(await removeShamSkill(db, "sham_v2", "pdf")).toMatch(/^error: لا مهارة محفوظة/);
  });

  it("ensureSkillTable only runs DDL for the real database or a test engine", async () => {
    let ddl = 0;
    const plain = { exec: async () => { ddl++; return undefined; }, query: async () => [] } as unknown as Db;
    await ensureSkillTable(plain);
    expect(ddl).toBe(0);
  });
});

describe("Sham Pro reviews its own record", () => {
  it("reports the real numbers of this chat and its saved skills", async () => {
    const db = fakeDb();
    await saveShamSkill(db, "sham_v2", "chat:1", SKILL);
    db.turns.push(
      { chat_key: "chat:1|v2", question: "ما عاصمة مصر؟", answer: "القاهرة." },
      { chat_key: "chat:1|v2", question: "وهل هي كبيرة؟", answer: "القاهرة." },
      { chat_key: "chat:1|v2", question: "اشرح التمثيل الضوئي", answer: "عملية تحول النباتات ضوء الشمس وثاني أكسيد الكربون والماء إلى سكر وأكسجين داخل البلاستيدات الخضراء." },
    );
    const out = await shamSelfReview(db, "sham_v2", "chat:1");
    expect(out).toContain("الجولات المحفوظة لهذا النموذج في كل المحادثات: 3");
    expect(out).toMatch(/آخر 3 جولة/);
    expect(out).toContain("2 ردّ أقصر من 40");
    expect(out).toContain("1 ردّ مكرّر متتالٍ");
    expect(out).toContain("quick_answer (0×)");
    expect(out).toContain("ما عاصمة مصر");
  });

  it("says there is no record yet instead of inventing one, and refuses numbers when the table is unreachable", async () => {
    const fresh = await shamSelfReview(fakeDb(), "sham_v2", "chat:1");
    expect(fresh).toContain("لا تحمل جولات محفوظة بعد");
    expect(fresh).toContain("لا شيء بعد (skill_save لم يُستخدم)");
    expect(await shamSelfReview(fakeDb({ fail: true }), "sham_v2", "chat:1")).toMatch(/^error: .*لا تخترع/);
  });
});

describe("self-development requests reach the tool loop", () => {
  it("recognises the owner's four messages", () => {
    for (const t of [
      "هل تستطيع تطوير نفسك ذاتيا",
      "قم بتحليل نفسك وقدراتك وماهي المشاكل التي تواجهك",
      "هل تستطيع انت تضيف هذه المهارات لنفسك",
      "قم باضافة لنفسك كل المهارات التي تحتاجها",
      "أضف إلى نفسك مهارة البحث العميق",
    ]) expect(isSelfDevelopmentRequest(t)).toBe(true);
  });

  it("leaves ordinary work about a project or a question alone", () => {
    for (const t of ["أضف مهارة إلى هذا المشروع", "حلّل لي المرحلة الثانية من المستودع", "طوّر لي صفحة الهبوط", "ما هي مهاراتك؟"]) expect(isSelfDevelopmentRequest(t)).toBe(false);
  });

  it("only Sham Pro's tool list has skill_save / skill_list / skill_delete / self_review", () => {
    const names = (variant: "v1" | "v2") => shamVariant.run(variant, () => shamTools(false).map((t) => t.function.name));
    expect(names("v2")).toEqual(expect.arrayContaining(["skill_save", "skill_list", "skill_delete", "self_review"]));
    expect(names("v1")).not.toContain("skill_save");
    expect(names("v1")).not.toContain("self_review");
    const save = shamVariant.run("v2", () => shamTools(false).find((t) => t.function.name === "skill_save")!);
    expect((save.function.parameters as { required: string[] }).required).toEqual(["name", "title", "when", "steps"]);
  });
});
