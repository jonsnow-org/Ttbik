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
  ownerOnly?: boolean;                 // never offered to users, whatever the visible switch says (Sham, Nova Pro)
  serveEnv?: string;                   // the env var that will hold its serving address (owner-side only)
  sort: number;
};

export const DEFAULT_MODELS: CoderModel[] = [
  { id: "coder", name: { ar: "Nova AI", en: "Nova AI" }, desc: { ar: "النموذج الحالي، متاح للجميع.", en: "The current model, for everyone." }, price_stars: null, visible: true, isDefault: true, sort: 0 },
  { id: "nova1", name: { ar: "نوفا 1", en: "Nova 1" }, desc: { ar: "نموذج برمجة عربي مُدرَّب خصيصاً (قيد التحضير).", en: "Our Arabic-tuned coding model (in preparation)." }, price_stars: null, visible: false, serveEnv: "NOVA1_STUDIO_URL", sort: 1 },
  { id: "sham", name: { ar: "شام", en: "Sham" }, desc: { ar: "نموذج شام.", en: "The Sham model." }, price_stars: null, visible: false, ownerOnly: true, serveEnv: "SHAM_MODEL_URL", sort: 2 },
  { id: "nova_pro", name: { ar: "نوفا برو", en: "Nova Pro" }, desc: { ar: "نموذج أقوى للمهام الصعبة (للمالك فقط).", en: "A stronger model for hard tasks (owner only)." }, price_stars: null, visible: false, ownerOnly: true, serveEnv: "NOVA_PRO_MODEL", sort: 3 },
  { id: "sham_v2", name: { ar: "شام v2 (متقدم)", en: "Sham v2 (advanced)" }, desc: { ar: "شام بجسم المانح الجديد داخل محرّك Nova: أدواته كلها (مدقّق ومحاولة ثانية وقيد صيغة)، مهام طويلة، تتبّع في الطرفية، صبر عند الانقطاع، ويتوزّع على أكثر من استوديو عند الازدحام (للمالك فقط).", en: "Sham with the new donor body inside Nova's engine: all tools (validator, retry, call-shape guard), long tasks, terminal tracking, patience on outages, spread over several Studios under load (owner only)." }, price_stars: null, visible: false, ownerOnly: true, sort: 5 },
  { id: "sham_loop", name: { ar: "شام (متقدم)", en: "Sham (advanced)" }, desc: { ar: "شام داخل محرّك Nova: بحث معمّق تُعطى مصادره لشام، مهام طويلة، تتبّع في الطرفية، صبر عند الانقطاع (للمالك فقط).", en: "Sham inside Nova's engine: deep research handed to Sham as sources, long tasks, terminal tracking, patience on outages (owner only)." }, price_stars: null, visible: false, ownerOnly: true, sort: 4 },
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
        visible: base.isDefault ? true : base.ownerOnly ? false : d.visible === undefined ? base.visible : Boolean(d.visible),
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
    visible: cur.isDefault ? true : cur.ownerOnly ? false : patch.visible === undefined ? cur.visible : Boolean(patch.visible),
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

/** The model a chat may use: its pick if still visible (the owner may use hidden ones to test), else the default. */
export function effectiveModel(models: CoderModel[], picked: string | undefined, owner: boolean): CoderModel {
  const m = models.find((x) => x.id === picked);
  if (m && (owner || (m.visible && !m.ownerOnly))) return m;
  return models.find((x) => x.isDefault) || models[0];
}

export type PublicModel = { id: string; name: { ar: string; en: string }; desc: { ar: string; en: string }; price_stars: number | null; selected: boolean };
export function publicModels(models: CoderModel[], picked: string | undefined): PublicModel[] {
  const sel = effectiveModel(models, picked, false).id;
  return models.filter((m) => m.visible && !m.ownerOnly).map((m) => ({ id: m.id, name: m.name, desc: m.desc, price_stars: m.price_stars, selected: m.id === sel }));
}

/** Owner view: every model, its switch, its price, and whether its serving address is set (never the address itself). */
export function ownerModels(models: CoderModel[], picked: string | undefined) {
  const sel = effectiveModel(models, picked, true).id;
  return models.map((m) => ({ id: m.id, name: m.name, desc: m.desc, price_stars: m.price_stars, visible: m.visible, isDefault: Boolean(m.isDefault), selected: m.id === sel, ready: m.isDefault || m.id === "sham" ? true : m.id === "sham_loop" || m.id === "sham_v2" ? shamStudioEnabled() : m.id === "nova_pro" ? providerReady("nova_pro") : Boolean(m.serveEnv && (process.env[m.serveEnv] || "").trim()) }));
}

/** The ONE way a chat changes model (Mini App picker and the bot's buttons both end here): the chosen model is the single source of
 *  truth, and the old Nova/Sham section follows from it. Returns false when this person may not use that model. */
export function chooseModel(st: { model?: string; mode: "coder" | "sham" }, models: CoderModel[], id: string, owner: boolean): boolean {
  const m = models.find((x) => x.id === id);
  if (!m || !(owner || (m.visible && !m.ownerOnly))) return false;
  if ((m.id === "sham_loop" || m.id === "sham_v2") && !shamStudioEnabled()) return false;                // needs Sham's Studio token
  if (m.id === "nova_pro" && !providerReady("nova_pro")) return false;     // not set up yet: it cannot be chosen
  st.model = m.id;
  st.mode = m.id === "sham" ? "sham" : "coder";
  return true;
}
