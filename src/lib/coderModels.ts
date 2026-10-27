// The coder's selectable models. Each entry has its own Stars price (null = included in the plan) and an owner switch that decides
// whether users can see it. Nova AI is the default and always visible (its own improvement, "Nova 1", is trained on branch training/nova1 and
// replaces its weights when ready: it is never a separate entry); "Sham" is hidden until the owner turns it on.
// Users only ever get { id, name, desc, price_stars, selected } — never the serving address or the model behind it.
import { prismaDb, type Db } from "@/lib/coderAuth";

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
  // The order here is the order in the picker: Nova AI (one, with everything added to it), Sham (the old one, every fix and tool added to its own code) and Sham v2 (the new body, tried beside it).
  { id: "coder", name: { ar: "Nova AI", en: "Nova AI" }, desc: { ar: "مبرمج ومساعد عملي للجميع: يصلح مشاريع GitHub في حاسوب افتراضي ويدفع الإصلاح ويفتح طلب الدمج، يبحث ويجدول ويفهم الصور ويصنع صوراً وصوتاً. أبطأ في المهام الطويلة وفي وضع التفكير والدقة العالية. يتحسّن بتدريب خاص بنا على الكود والأدوات (Nova 1) يُستبدَل به حين يجهز.", en: "Practical coder and assistant for everyone: fixes GitHub projects in a private computer, pushes the fix and opens the pull request, searches, schedules, reads images and makes pictures and speech. Slower on long tasks and in thinking / high-accuracy mode. Improved by our own training on code and tools (Nova 1), which replaces its weights when ready." }, price_stars: null, visible: true, isDefault: true, sort: 0 },
  { id: "sham", name: { ar: "شام (القديم)", en: "Sham (old)" }, desc: { ar: "نموذجنا الأصلي الذي بنيناه من الصفر، بمساره الخاص المنفصل تمامًا عن Nova (استوديوه وبحثه وذاكرته ونظامه هو). تُضاف تحسيناته في كوده وهيكله هو، لا في أدوات Nova. يقرر بنفسه أن يجيب أو يبحث أو يرسم أو ينطق. الدقة والسرعة تؤثران فيه فعلًا، أما التفكير فلا يدعمه جسمه. تدريبه غير مكتمل، فردوده أضعف من Nova AI. أدواته (حاسوب افتراضي وغيره) تعمل عليه حين يُفعَّل وكيله، وتبقى موافقتك شرطاً قبل أي رفع أو دمج.", en: "Our original model, built from scratch, on its own path fully separate from Nova (its own Studio, search, memory and system). Its improvements go into its own code and structure, not into Nova's tools. It decides by itself whether to answer, search, draw or speak. Accuracy and speed really change it; thinking is not supported by its body. Training is not finished, so its replies are weaker than Nova AI." }, price_stars: null, visible: false, ownerOnly: true, serveEnv: "SHAM_MODEL_URL", sort: 1 },
  { id: "sham_v2", name: { ar: "شام v2 (الجديد)", en: "Sham v2 (new)" }, desc: { ar: "شام بجسم جديد (نموذج مفتوح المصدر مدرَّب داخل صنف شام) على استوديو منفصل ومسار منفصل، نجربه بجانب القديم. التفكير (فقرة تفكير قصيرة قبل الجواب) والدقة والسرعة تغيّر سلوكه فعلًا. له أدواته الخاصة: بحث الويب وقراءة GitHub وحاسوب افتراضي خاص به وذاكرة وجدولة وصنع صور وصوت، ولا يرفع تعديلاً ولا يفتح أو يدمج طلب دمج إلا بعد ضغطك «نفّذ». قيد التجربة.", en: "Sham with a new body (a trained open model inside Sham's class) on its own Studio and own path, tried beside the old one. Thinking (a short thought before the answer), accuracy and speed really change it. It has its own tools: web search, GitHub reading, its own private computer, memory, schedules and making pictures / sound, and it never pushes, opens or merges a pull request until you tap «Run». Under test." }, price_stars: null, visible: false, ownerOnly: true, sort: 2 },
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
/** Older chats may hold the id of the former "Sham (advanced)" entry: it was merged into the old Sham (which now has everything it had). */
export const canonModelId = (id: string | undefined): string | undefined => (id === "sham_loop" ? "sham" : id);

/** Is a model-server token present (the Studios Sham runs on share the platform token)? Read from the environment here so the model list needs nothing from Sham's code. */
const studioTokenSet = (): boolean => Boolean((process.env.MODELSCOPE_API_TOKEN || "").trim());
/** The model id Nova's own engine is given: Sham models are never served by Nova's engine (they run on Sham's own path), so they map to Nova's default. */
export const novaModelOf = (id: string | undefined): string | undefined => (id === "sham" || id === "sham_v2" || id === "sham_loop" || id === "sham_probe" ? undefined : id);

export function modelReady(m: CoderModel): boolean {
  if (m.isDefault) return true;
  if (m.id === "sham" || m.id === "sham_v2") return studioTokenSet();
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
  if ((m.id === "sham" || m.id === "sham_v2") && !studioTokenSet()) return false;                // they need the Studio token
  st.model = m.id;
  st.mode = m.id === "sham" || m.id === "sham_v2" ? "sham" : "coder";   // Sham (old and new) runs on its OWN path, separate from Nova's engine, tools and Studios
  return true;
}
