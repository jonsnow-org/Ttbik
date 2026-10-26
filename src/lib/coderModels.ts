// The coder's selectable models. Each entry has its own Stars price (null = included in the plan) and an owner switch that decides
// whether users can see it. The current model is the default and always visible; "Nova 1" (the coder model being prepared on
// branch training/nova1) and "Sham" are listed but hidden until the owner turns them on.
// Users only ever get { id, name, desc, price_stars, selected } — never the serving address or the model behind it.
import { prismaDb, type Db } from "@/lib/coderAuth";
import { providerReady } from "@/lib/coderProvider";
import { shamStudioEnabled } from "@/lib/shamStudio";

export type CoderModel = {
  id: string;
  name: { ar: string; en: string };
  desc: { ar: string; en: string };
  price_stars: number | null;          // null or 0 = no extra charge
  visible: boolean;                    // owner switch: shown to users
  isDefault?: boolean;
  ownerOnly?: boolean;                 // owner-only UNTIL the owner turns the visible switch on (one tap makes it public); a model that is not ready (no Studio / key) is never shown to users either
  serveEnv?: string;                   // the env var that will hold its serving address (owner-side only)
  sort: number;
};

export const DEFAULT_MODELS: CoderModel[] = [
  // The order here is the order in the picker. ONE Sham only: its abilities and its body (old / new) change behind this entry (SHAM_BODY), never as another entry. Each description says what the model is FOR and where it stands today (kept true to what was measured).
  { id: "coder", name: { ar: "Nova AI", en: "Nova AI" }, desc: { ar: "مبرمج ومساعد عملي للجميع: يصلح مشاريع GitHub في حاسوب افتراضي ويدفع الإصلاح ويفتح طلب الدمج، يبحث ويجدول ويفهم الصور ويصنع صوراً وصوتاً. أبطأ في المهام الطويلة وفي وضع التفكير والدقة العالية.", en: "Practical coder and assistant for everyone: fixes GitHub projects in a private computer, pushes the fix and opens the pull request, searches, schedules, reads images and makes pictures and speech. Slower on long tasks and in thinking / high-accuracy mode." }, price_stars: null, visible: true, isDefault: true, sort: 0 },
  { id: "sham_loop", name: { ar: "شام", en: "Sham" }, desc: { ar: "نموذجنا الذي بنيناه بأنفسنا، يعمل داخل محرّك Nova: يبحث ويستعمل الأدوات ويتتبّع المهام الطويلة ويصبر عند الانقطاع. لم يكتمل تدريبه بعد، فردوده ما زالت أضعف من Nova AI.", en: "Our own model, built from scratch, running inside Nova's engine: searches, uses tools, tracks long tasks and is patient on outages. Training is not finished, so its replies are still weaker than Nova AI." }, price_stars: null, visible: false, ownerOnly: true, sort: 1 },
  { id: "nova_pro", name: { ar: "نوفا برو", en: "Nova Pro" }, desc: { ar: "نموذج أكبر تستضيفه خدمة ModelScope الجاهزة (ليس على استوديوهاتنا) للمهام الأصعب. يعمل حين يُضبط اسم النموذج NOVA_PRO_MODEL، وحصته المجانية محدودة.", en: "A bigger model hosted by ModelScope's ready-made API (not on our Studios) for harder tasks. Works once NOVA_PRO_MODEL names the model; its free quota is limited." }, price_stars: null, visible: false, ownerOnly: true, serveEnv: "NOVA_PRO_MODEL", sort: 4 },
  { id: "nova1", name: { ar: "نوفا 1", en: "Nova 1" }, desc: { ar: "نفس نموذج Nova AI الأساسي (Qwen3.5-4B) بعد تدريب خفيف خاص بنا على الكود والإصلاح وصيغة أدوات البوت. قيد التدريب على Kaggle ولم يُنشر بعد.", en: "The same base model as Nova AI (Qwen3.5-4B) after our own light training on code, bug fixing and the bot's tool format. Training on Kaggle, not published yet." }, price_stars: null, visible: false, serveEnv: "NOVA1_STUDIO_URL", sort: 5 },
];
export const DEFAULT_MODEL_ID = "coder";

let ready: Promise<void> | null = null;
function ensureTable(db: Db): Promise<void> {
  if (db !== prismaDb) return db.exec(`CREATE TABLE IF NOT EXISTS coder_models (id TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`).then(() => undefined);
  if (!ready) {
    ready = db.exec(`CREATE TABLE IF NOT EXISTS coder_models (id TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`).then(() => undefined).catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

const cleanStars = (v: unknown): number | null => (v === null || v === "" || v === undefined || !(Number(v) > 0) ? null : Math.min(100000, Math.floor(Number(v))));

export async function listModels(db: Db = prismaDb): Promise<CoderModel[]> {
  const byId = new Map<string, CoderModel>(DEFAULT_MODELS.map((m) => [m.id, { ...m }]));
  try {
    await ensureTable(db);
    for (const r of await db.query<{ id: string; data: any }>(`SELECT id, data FROM coder_models`)) {
      const d = typeof r.data === "string" ? JSON.parse(r.data) : r.data || {};
      const base = byId.get(r.id);
      if (!base) continue;                                    // only known models (a new one is added here in code)
      byId.set(r.id, {
        ...base,
        name: { ar: String(d.name?.ar || base.name.ar).slice(0, 40), en: String(d.name?.en || base.name.en).slice(0, 40) },
        price_stars: d.price_stars === undefined ? base.price_stars : cleanStars(d.price_stars),
        visible: base.isDefault ? true : d.visible === undefined ? base.visible : Boolean(d.visible),
      });
    }
  } catch {
    /* defaults */
  }
  return [...byId.values()].sort((a, b) => a.sort - b.sort);
}

/** Owner only (checked by the caller). */
export async function updateModel(id: string, patch: { visible?: unknown; price_stars?: unknown; name?: { ar?: unknown; en?: unknown } }, db: Db = prismaDb): Promise<CoderModel> {
  const cur = (await listModels(db)).find((m) => m.id === id);
  if (!cur) throw new Error("unknown model");
  const next: CoderModel = {
    ...cur,
    visible: cur.isDefault ? true : patch.visible === undefined ? cur.visible : Boolean(patch.visible),
    price_stars: patch.price_stars === undefined ? cur.price_stars : cleanStars(patch.price_stars),
    name: { ar: String(patch.name?.ar ?? cur.name.ar).slice(0, 40), en: String(patch.name?.en ?? cur.name.en).slice(0, 40) },
  };
  await ensureTable(db);
  await db.exec(
    `INSERT INTO coder_models (id, data) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    id, JSON.stringify({ name: next.name, price_stars: next.price_stars, visible: next.visible }),
  );
  return next;
}

/** Can this model answer right now (its Studio / key is set)? A model that is switched on for everyone but is not ready is still hidden from users. */
/** Older chats may hold the ids of the former separate Sham entries: they are the one Sham now. */
export const canonModelId = (id: string | undefined): string | undefined => (id === "sham" || id === "sham_v2" ? "sham_loop" : id);

export function modelReady(m: CoderModel): boolean {
  if (m.isDefault) return true;
  if (m.id === "sham_loop") return shamStudioEnabled();
  if (m.id === "nova_pro") return providerReady("nova_pro");
  return Boolean(m.serveEnv && (process.env[m.serveEnv] || "").trim());
}
const openToUsers = (m: CoderModel): boolean => m.visible && modelReady(m);

/** The model a chat may use: its pick if still visible (the owner may use hidden ones to test), else the default. */
export function effectiveModel(models: CoderModel[], picked: string | undefined, owner: boolean): CoderModel {
  const m = models.find((x) => x.id === canonModelId(picked));
  if (m && (owner || openToUsers(m))) return m;
  return models.find((x) => x.isDefault) || models[0];
}

export type PublicModel = { id: string; name: { ar: string; en: string }; desc: { ar: string; en: string }; price_stars: number | null; selected: boolean };
export function publicModels(models: CoderModel[], picked: string | undefined): PublicModel[] {
  const sel = effectiveModel(models, picked, false).id;
  return models.filter(openToUsers).map((m) => ({ id: m.id, name: m.name, desc: m.desc, price_stars: m.price_stars, selected: m.id === sel }));
}

/** Owner view: every model, its switch, its price, and whether its serving address is set (never the address itself). */
export function ownerModels(models: CoderModel[], picked: string | undefined) {
  const sel = effectiveModel(models, picked, true).id;
  return models.map((m) => ({ id: m.id, name: m.name, desc: m.desc, price_stars: m.price_stars, visible: m.visible, isDefault: Boolean(m.isDefault), selected: m.id === sel, ready: modelReady(m) }));
}

/** The ONE way a chat changes model (Mini App picker and the bot's buttons both end here): the chosen model is the single source of
 *  truth, and the old Nova/Sham section follows from it. Returns false when this person may not use that model. */
export function chooseModel(st: { model?: string; mode: "coder" | "sham" }, models: CoderModel[], id: string, owner: boolean): boolean {
  const m = models.find((x) => x.id === canonModelId(id));
  if (!m || !(owner || openToUsers(m))) return false;
  if (m.id === "sham_loop" && !shamStudioEnabled()) return false;                // needs Sham's Studio token
  if (m.id === "nova_pro" && !providerReady("nova_pro")) return false;     // not set up yet: it cannot be chosen
  st.model = m.id;
  st.mode = "coder";                                          // the old direct Sham path is no longer offered: every model runs in the engine
  return true;
}
