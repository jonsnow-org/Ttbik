// SHAM PRO's OWN skill file, writable by Sham Pro itself (owner 2026-11-26: «قم باضافة لنفسك كل المهارات التي تحتاجها» — the model answered that it had
// "added" eight skills and nothing existed anywhere: skillsShamPro.ts is a fixed file in the repo, and the `skill` tool could only READ it).
// Here Sham Pro's skills are rows it writes itself (`skill_save`) and reads back with `skill` in any later chat, on any server restart: a skill is a
// procedure (when to use it + the exact steps with real tool names), not a claim. Nothing is stored without a row: a tool call that did not return
// "حُفظت" means nothing was added, and the model is told exactly that (shamTools.ts FORMAT_SELF).
// `self_review` reads the SAME tables that carry its real work (sham_chat_memory turns, its own skill rows and their use count): numbers and real
// questions, never an opinion about itself. Every database step is best-effort and says so instead of pretending.
import type { Db } from "@/lib/shamDb";
import { prismaDb } from "@/lib/shamDb";
import { nearSameReply } from "@/lib/shamMemory";

/** A model keeps at most this many of its own skills (each one rides in every tool prompt, and the body has ~1200 prompt tokens). */
export const SHAM_SKILLS_MAX = 40;
export const SKILL_NAME = /^[a-z][a-z0-9_-]{1,31}$/;
const MAX = { title: 90, when: 220, steps: 1600 };

export type ShamSkill = { name: string; title: string; when: string; steps: string; uses: number };
export type SkillDraft = { name: string; title: string; when: string; steps: string };

/** What the model typed → a storable skill, or the reason it is not one. Nothing is trimmed into shape silently. */
export function cleanSkill(a: { name?: unknown; title?: unknown; when?: unknown; steps?: unknown }): { ok: true; skill: SkillDraft } | { ok: false; error: string } {
  const name = String(a.name ?? "").trim().toLowerCase();
  const title = String(a.title ?? "").replace(/\s+/g, " ").trim();
  const when = String(a.when ?? "").replace(/\s+/g, " ").trim();
  const steps = String(a.steps ?? "").replace(/```[a-z]*\n?/gi, "").trim();
  if (!SKILL_NAME.test(name)) return { ok: false, error: `الاسم «${name.slice(0, 40)}» غير صالح: حروف إنكليزية صغيرة وأرقام و- و_ فقط، من 2 إلى 32 حرفاً، ويبدأ بحرف.` };
  if (title.length < 3 || title.length > MAX.title) return { ok: false, error: `العنوان يجب أن يكون بين 3 و${MAX.title} حرفاً.` };
  if (when.length < 3 || when.length > MAX.when) return { ok: false, error: `«when» يجب أن يكون بين 3 و${MAX.when} حرفاً (متى تُستعمل المهارة).` };
  if (steps.length < 20 || steps.length > MAX.steps) return { ok: false, error: `الخطوات يجب أن تكون بين 20 و${MAX.steps} حرفاً، وتذكر أسماء الأدوات الحقيقية بالترتيب.` };
  return { ok: true, skill: { name, title, when, steps } };
}

/** A request to work on itself (not on the user's project): those turns must reach the tool loop, where skill_save / self_review really exist. */
export function isSelfDevelopmentRequest(text: string): boolean {
  const t = String(text || "").normalize("NFKC");
  return (
    /(?:طوّ?ر|تطوير|تحسين)\s+(?:نفسك|ذاتك)/i.test(t) ||
    /تطوير\s+ذاتي|تطوير\s+نفسك\s+ذاتيا/i.test(t) ||
    /(?:أضف|اضف|تضيف|إضافة|اضافة|اضافه)\s+(?:لنفسك|إلى\s+نفسك|الي\s+نفسك)/i.test(t) ||
    /(?:أضف|اضف|تضيف|إضافة|اضافة|اضافه)\s+(?:هذه|كل)?\s*(?:ال)?مهارات[^.\n]{0,30}لنفسك/i.test(t) ||

    /(?:حلّل|حلل|تحليل)\s+(?:نفسك|قدراتك)/i.test(t) ||
    /(?:مهارات|قدرات)(?:ك)?\s+(?:التي\s+تحتاج|لنفسك)/i.test(t) ||
    /(?:add|save)\s+(?:new\s+)?skills?\s+(?:to\s+)?yourself|improve\s+yourself/i.test(t)
  );
}

const readyBy = new WeakMap<object, Promise<void>>();
/** The table is created on first use (the same lazy DDL as shamMemory.ts): no SQL editor step is required for changes to work. */
export function ensureSkillTable(db: Db): Promise<void> {
  if (db !== prismaDb && !(db as { ddl?: boolean }).ddl) return Promise.resolve();   // `ddl: true` = a real SQL engine in tests
  let ready = readyBy.get(db) || null;
  if (!ready) {
    ready = db.exec(`CREATE TABLE IF NOT EXISTS sham_skills (model TEXT NOT NULL, name TEXT NOT NULL, title TEXT NOT NULL, when_hint TEXT NOT NULL DEFAULT '', steps TEXT NOT NULL, source_chat TEXT NOT NULL DEFAULT '', uses INT NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (model, name))`)
      .then(() => undefined)
      .catch((e) => { readyBy.delete(db); throw e; });
    readyBy.set(db, ready);
  }
  return ready;
}

/** Its own skills, newest edit first. Empty on any database failure (the caller says so when it matters). */
export async function listShamSkills(db: Db, model: string): Promise<ShamSkill[]> {
  try {
    await ensureSkillTable(db);
    const rows = await db.query<{ name: string; title: string; when_hint: string; steps: string; uses: number | string }>(
      `SELECT name, title, when_hint, steps, uses FROM sham_skills WHERE model=$1 ORDER BY updated_at DESC, name ASC`, model);
    return rows.map((r) => ({ name: String(r.name), title: String(r.title || ""), when: String(r.when_hint || ""), steps: String(r.steps || ""), uses: Number(r.uses) || 0 }));
  } catch { return []; }
}

/** `skill_save`: store (or replace) one skill of its own. Returns the exact result line the model reads — success is a row, nothing else. */
export async function saveShamSkill(db: Db, model: string, chatKey: string, a: { name?: unknown; title?: unknown; when?: unknown; steps?: unknown }): Promise<string> {
  const c = cleanSkill(a);
  if (!c.ok) return `error: لم يُحفظ شيء. ${c.error}`;
  const s = c.skill;
  try {
    await ensureSkillTable(db);
    const found = await db.query<{ name: string }>(`SELECT name FROM sham_skills WHERE model=$1 AND name=$2`, model, s.name);
    if (!found.length) {
      const count = await db.query<{ n: string | number }>(`SELECT count(*) AS n FROM sham_skills WHERE model=$1`, model);
      if (Number(count[0]?.n || 0) >= SHAM_SKILLS_MAX) return `error: لم يُحفظ شيء. لديك ${SHAM_SKILLS_MAX} مهارة مسجَّلة وهي الحد الأقصى؛ احذف واحدة بـ skill_delete أولاً.`;
    }
    await db.exec(
      `INSERT INTO sham_skills (model, name, title, when_hint, steps, source_chat, updated_at) VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (model, name) DO UPDATE SET title=EXCLUDED.title, when_hint=EXCLUDED.when_hint, steps=EXCLUDED.steps, source_chat=EXCLUDED.source_chat, updated_at=now()`,
      model, s.name, s.title, s.when, s.steps, String(chatKey || "").slice(0, 80));
    const verify = await db.query<{ name: string }>(`SELECT name FROM sham_skills WHERE model=$1 AND name=$2`, model, s.name);
    if (!verify.length) return "error: لم يُحفظ شيء. الكتابة لم تُثبت في الجدول؛ لا تقل إنك أضفت المهارة.";
    return `حُفظت المهارة «${s.name}» في ملف مهاراتك (${found.length ? "حُدِّثت" : "جديدة"}) وتُفتح في أي محادثة لاحقة بـ skill(name="${s.name}"). عنوانها: ${s.title}`;
  } catch (e) {
    return `error: لم يُحفظ شيء. تعذّر الوصول إلى مخزن المهارات: ${String((e as Error)?.message || e).slice(0, 200)}`;
  }
}

/** `skill_delete`: only a skill it wrote itself; the built-in file in the repo is not touched. */
export async function removeShamSkill(db: Db, model: string, name: string): Promise<string> {
  const n = String(name || "").trim().toLowerCase();
  if (!SKILL_NAME.test(n)) return `error: اسم غير صالح «${n.slice(0, 40)}».`;
  try {
    await ensureSkillTable(db);
    const found = await db.query<{ name: string }>(`SELECT name FROM sham_skills WHERE model=$1 AND name=$2`, model, n);
    if (!found.length) return `error: لا مهارة محفوظة بهذا الاسم عندك: «${n}». استخدم skill_list لمعرفة المحفوظ.`;
    await db.exec(`DELETE FROM sham_skills WHERE model=$1 AND name=$2`, model, n);
    return `حُذفت المهارة «${n}» من ملف مهاراتك.`;
  } catch (e) {
    return `error: تعذّر الحذف: ${String((e as Error)?.message || e).slice(0, 200)}`;
  }
}

/** A saved skill as the same SKILL text the built-in loader returns, and its use is counted (a skill nobody opens is dead weight). */
export async function savedSkillText(db: Db, model: string, name: string): Promise<string | null> {
  const n = String(name || "").trim().toLowerCase();
  if (!SKILL_NAME.test(n)) return null;
  try {
    await ensureSkillTable(db);
    const rows = await db.query<{ title: string; when_hint: string; steps: string }>(`SELECT title, when_hint, steps FROM sham_skills WHERE model=$1 AND name=$2`, model, n);
    if (!rows.length) return null;
    void Promise.resolve(db.exec(`UPDATE sham_skills SET uses = uses + 1 WHERE model=$1 AND name=$2`, model, n)).catch(() => undefined);
    const r = rows[0];
    return `SKILL ${n} (محفوظة بيد شام برو): ${String(r.title || "")}\nUse when: ${String(r.when_hint || "")}\n${String(r.steps || "")}`;
  } catch { return null; }
}

/** One short line in the tool prompt: what Sham Pro already taught itself (without it a saved skill is invisible until it guesses the name). */
export async function savedSkillsNote(db: Db, model: string): Promise<string> {
  const skills = (await listShamSkills(db, model)).slice(0, 12);
  if (!skills.length) return "";
  const parts = skills.map((s) => `${s.name}${s.uses ? ` (${s.uses}×)` : ""} — ${s.when.slice(0, 60)}`);
  return `مهاراتك المحفوظة بيدك (تفتحها بـ skill باسمها): ${parts.join("؛ ")}.`.slice(0, 700);
}

const short = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

/** The marker that separates the model-facing report from the sentence a person may read. Everything above it is plumbing. */
export const OWNER_MARK = "— ما يُقال للمالك —";

export type SelfReviewTasks = { total: number; done: number; failed: number; running: number };
export type SelfReview = {
  totalTurns: number;
  chatTurns: number;
  shortOnes: number;
  repeats: number;
  avg: number;
  topics: string[];
  skills: ShamSkill[];
  tasks: SelfReviewTasks | null;
};

/** The real numbers behind `self_review`, read once: turns, saved skills and this chat's tasks. A read that fails returns the honest error text (never zeros).
 *  The task counts come from the host (shamHost.ts: the task table belongs to the platform, and it applies the lease rule before counting);
 *  Sham's own modules never read a Nova table themselves. `undefined` = not asked for, `null` = the count could not be read. */
export async function shamSelfReviewData(db: Db, model: string, chatKey: string, tasks?: SelfReviewTasks | null): Promise<SelfReview | { error: string }> {
  let total = 0;
  let rows: { question: string; answer: string }[] = [];
  try {
    await ensureSkillTable(db);
    const variant = model === "sham_v2" ? "v2" : "v1";
    const n = await db.query<{ n: string | number }>(`SELECT count(*) AS n FROM sham_chat_memory WHERE chat_key LIKE $1 OR chat_key LIKE $2`, `%|${variant}`, `%|${variant}|%`);
    total = Number(n[0]?.n || 0);
    rows = await db.query<{ question: string; answer: string }>(
      `SELECT question, answer FROM sham_chat_memory WHERE chat_key=$1 OR chat_key LIKE $2 ORDER BY id DESC LIMIT 60`, chatKey, `${chatKey}|%`);
  } catch (e) {
    return { error: `تعذّر قراءة سجلّك الآن: ${String((e as Error)?.message || e).slice(0, 160)}. لا تخترع أرقاماً بدلاً منها.` };
  }
  const shortOnes = rows.filter((r) => (r.answer || "").trim().length < 40).length;
  let repeats = 0;
  for (let i = 1; i < rows.length; i++) if (nearSameReply(rows[i - 1].answer || "", rows[i].answer || "")) repeats++;
  const avg = rows.length ? Math.round(rows.reduce((s, r) => s + (r.answer || "").trim().length, 0) / rows.length) : 0;
  const topics = rows.slice(0, 5).map((r) => String(r.question || "").replace(/\s+/g, " ").trim()).filter(Boolean);
  const skills = await listShamSkills(db, model);
  // This chat's own tasks for this model: the same table every other screen reads, so a leftover row shows up here instead of being guessed at.
  return { totalTurns: total, chatTurns: rows.length, shortOnes, repeats, avg, topics, skills, tasks: tasks === undefined ? null : tasks };
}

/** The report the model reads (real data + one concrete next action). Never handed to the owner as-is: `selfReviewAnswer` is. */
export function selfReviewReport(d: SelfReview): string {
  const lines: string[] = ["تقرير من سجلّك الحقيقي (أرقام من الجداول، لا تقديرات):"];
  lines.push(`• الجولات المحفوظة لهذا النموذج في كل المحادثات: ${d.totalTurns}.`);
  if (!d.chatTurns) lines.push("• هذه المحادثة لا تحمل جولات محفوظة بعد (الذاكرة قد تكون مغلقة أو الجلسة جديدة).");
  else {
    lines.push(`• آخر ${d.chatTurns} جولة في هذه المحادثة: ${d.shortOnes} ردّ أقصر من 40 حرفاً، ${d.repeats} ردّ مكرّر متتالٍ، متوسط طول الرد ${d.avg} حرفاً.`);
    if (d.topics.length) lines.push(`• آخر ما سُئلت عنه هنا: ${d.topics.map((t) => `«${short(t, 70)}»`).join(" | ")}`);
  }
  if (d.tasks) lines.push(d.tasks.total
    ? `• مهامك في هذه المحادثة: ${d.tasks.total} — ${d.tasks.done} منتهية، ${d.tasks.failed} فاشلة أو موقوفة، ${d.tasks.running} قيد التشغيل.`
    : "• لا مهام مسجَّلة في هذه المحادثة.");
  lines.push(d.skills.length
    ? `• مهاراتك المحفوظة بيدك: ${d.skills.length} — ${d.skills.slice(0, 8).map((s) => `${s.name} (${s.uses}×)`).join("، ")}.`
    : "• مهاراتك المحفوظة بيدك: لا شيء بعد (skill_save لم يُستخدم).");
  lines.push("اختر أضعف رقم أعلاه، اذكر إصلاحاً واحداً محدداً له، ثم خزّن الإجراء الذي يعالجه بـ skill_save.");
  return lines.join("\n");
}

/** What the owner reads when the model could not phrase it: the same numbers, in plain Arabic, with no instruction aimed at the model. */
export function selfReviewAnswer(d: SelfReview): string {
  const lines: string[] = ["هذا تحليلي من سجلّي الحقيقي، لا من تقدير:"];
  lines.push(`• جولاتي المحفوظة في كل المحادثات: ${d.totalTurns}.`);
  if (!d.chatTurns) lines.push("• في هذه المحادثة لا توجد جولات محفوظة بعد.");
  else lines.push(`• في هذه المحادثة ${d.chatTurns} جولة، منها ${d.shortOnes} ردّ أقصر من 40 حرفاً و${d.repeats} ردّ مكرّر متتالٍ، ومتوسط طول الرد ${d.avg} حرفاً.`);
  if (d.tasks) {
    const t = d.tasks;
    lines.push(t.total ? `• مهامي في هذه المحادثة: ${t.total} — ${t.done} منتهية، ${t.failed} فاشلة أو موقوفة${t.running ? `، و${t.running} قيد التشغيل` : "، ولا مهمة عالقة"}.` : "• لا مهام مسجَّلة في هذه المحادثة.");
  }
  lines.push(d.skills.length
    ? `• مهاراتي التي كتبتها بيدي: ${d.skills.length} — ${d.skills.slice(0, 8).map((s) => `«${s.name}» (استُعملت ${s.uses} مرة)`).join("، ")}.`
    : "• مهاراتي التي كتبتها بيدي: لا شيء بعد.");
  lines.push("هذه أرقامي كما هي في الجداول الآن.");
  return lines.join("\n");
}

/** A line aimed at the model (a directive, a JSON key, a tool name) never reaches a person's screen. */
const INTERNAL_LINE: RegExp[] = [
  /اختر أضعف رقم/, /\[تصحيح من المحرك\]/, /\[من سجلّك/, /مرحلة التحقق/, /^\s*error\s*:/i,
  /\bself_review\b/, /\bskill_(save|list|delete|read)\b/, /"[a-z_]+"\s*:/i, /^\s*[{\[]/, /\btool_calls?\b/i,
  /^\s*(assistant|system|user|tool)\s*:/i,
];

/** Removes plumbing from any text before it is sent: directive lines, JSON, tool names, and lines with no Arabic at all. */
export function stripInternal(text: string): string {
  const kept = String(text || "").replace(/\r/g, "").split("\n").filter((line) => {
    const l = line.trim();
    if (!l) return true;
    if (INTERNAL_LINE.some((re) => re.test(l))) return false;
    return /[\u0600-\u06FF]/.test(l);        // an English-only line is scaffolding, not an answer
  });
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]+$/gm, "").trim();
}

/** The owner-facing part of a tool result: before OWNER_MARK when the tool wrote one (so a truncated result still carries it), otherwise the text itself, always stripped. */
export function ownerAnswerFromTool(text: string): string {
  const t = String(text || "");
  const i = t.indexOf(OWNER_MARK);
  return stripInternal(i >= 0 ? t.slice(0, i) : t);
}

/** `self_review`: real numbers from the tables that carry its work, plus what this chat actually asked. No self-praise, no estimates.
 * The model sees the report (and one concrete next action); the owner's own sentence follows OWNER_MARK so a silent model still answers cleanly. */
export async function shamSelfReview(db: Db, model: string, chatKey: string, tasks?: SelfReviewTasks | null): Promise<string> {
  const d = await shamSelfReviewData(db, model, chatKey, tasks);
  if ("error" in d) return `error: ${d.error}`;
  // The owner's sentence comes FIRST: a result trimmed on its way to the chat still carries the part a person reads.
  return `${selfReviewAnswer(d)}\n\n${OWNER_MARK}\n${selfReviewReport(d)}`;
}
