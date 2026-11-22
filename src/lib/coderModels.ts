// The coder's selectable models. Each entry has its own Stars price (null = included in the plan) and an owner switch that decides
// whether users can see it. Nova AI is the default and visible unless the owner hides it with its own switch (its own improvement, "Nova 1", is trained on branch training/nova1 and
// replaces its weights when ready: it is never a separate entry); "Sham" is hidden until the owner turns it on.
// Users only ever get { id, name, desc, price_stars, selected } — never the serving address or the model behind it.
import { secretCached } from "@/lib/hostedSecrets";
import { nova2TokenSet, nova2Urls } from "@/lib/openCoderStudio";
import { prismaDb, type Db } from "@/lib/coderAuth";

export type CoderModel = {
  id: string;
  name: { ar: string; en: string };
  desc: { ar: string; en: string };
  price_stars: number | null;          // null or 0 = no extra charge
  visible: boolean;                    // owner switch: shown to users
  isDefault?: boolean;
  ownerOnly?: boolean;                 // initially private; can be exposed by the owner
  lockedOwnerOnly?: boolean;            // permanently private; owner cannot expose it (no model uses it since 2026-11-04: owner t88u wants a show/hide switch for EVERY model)
  serveEnv?: string;                   // the env var that will hold its serving address (owner-side only)
  publicRolloutVersion?: number;       // one-time public rollout; preserve later owner visibility changes
  sort: number;
};

export const DEFAULT_MODELS: CoderModel[] = [
  // The order here is the order in the picker: Nova AI (one, with everything added to it), Sham (the old one, every fix and tool added to its own code) and Sham v2 (the new body, tried beside it).
  { id: "coder", name: { ar: "Nova AI", en: "Nova AI" }, desc: { ar: "مبرمج ومساعد عملي: يصلح مشاريع GitHub ويبحث ويجدول ويفهم الصور ويصنع الصور والصوت والفيديو.", en: "Practical coder and assistant: fixes GitHub projects, searches, schedules, reads pictures and makes pictures, speech and video." }, price_stars: null, visible: true, isDefault: true, sort: 0 },
  { id: "sham", name: { ar: "شام (القديم)", en: "Sham (old)" }, desc: { ar: "نموذجنا الأصلي المبني من الصفر، بمساره واستوديوهاته الخاصة.", en: "Our original model, built from scratch, on its own path and Studios." }, price_stars: null, visible: false, ownerOnly: true, serveEnv: "SHAM_MODEL_URL", sort: 1 },
  { id: "sham_v2", name: { ar: "شام برو", en: "Sham Pro" }, desc: { ar: "شام برو، نسخة من شام 1 بأوزان المانح ونظام T-LDM (يُفعَّل بمفتاح المالك عندما يكون الرأس جاهزًا) وبأدواته ووسائطه وحاسوبه الداخلي.", en: "Sham Pro, the copy of Sham 1 with donor weights and the T-LDM system (owner switch, once the trained head exists), with its own tools, media and internal computer." }, price_stars: null, visible: true, ownerOnly: false, publicRolloutVersion: 1, sort: 2 },
  // The three donor candidates (Qwen3.5-9B, Gemma 4 E4B, MiniCPM-o 4.5) were removed on 2026-11-08 (owner's order): none beat Nova in the real task test.
  // "free i" (owner 2026-11-08): the AI Agent path as a picker entry. Picking it sends the owner's messages to the GitHub AI Agent (a free OpenRouter model) instead of any model of this app; owner-only.
  { id: "freei", name: { ar: "free i", en: "free i" }, desc: { ar: "وكيل مجاني عبر GitHub (OpenRouter): يجيب ويقترح، وقد يفتح طلب دمج. للمالك فقط.", en: "Free GitHub agent (OpenRouter): answers and proposes, may open a pull request. Owner only." }, price_stars: null, visible: false, ownerOnly: true, sort: 50 },
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
      const name = { ar: String(d.name?.ar || base.name.ar).slice(0, 40), en: String(d.name?.en || base.name.en).slice(0, 40) };
      if (r.id === "sham_v2") {          // stock labels become "Sham Pro" / «شام برو»; a custom name the owner typed is kept
        const stockAr = new Set(["", "شام v2", "شام v2 (الجديد)", "شام (الجديد)", "شام 2", "شام ٢"]);
        const stockEn = new Set(["", "Sham v2", "Sham v2 (new)", "Sham (new)", "Sham 2"]);
        if (stockAr.has(name.ar.trim())) name.ar = base.name.ar;
        if (stockEn.has(name.en.trim())) name.en = base.name.en;
      }
      const price_stars = d.price_stars === undefined ? base.price_stars : cleanStars(d.price_stars);
      let visible = d.visible === undefined ? base.visible : Boolean(d.visible);
      let publicRolloutVersion = Number(d.publicRolloutVersion || 0);
      // One-time migration: old persisted Sham v2 rows were hidden. Persist the marker so owner changes are not overridden.
      if (r.id === "sham_v2" && publicRolloutVersion < 1 && studioTokenSet()) {
        visible = true;
        publicRolloutVersion = 1;
        await db.exec(
          `INSERT INTO coder_models (id, data) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
          r.id, JSON.stringify({ name, price_stars, visible, publicRolloutVersion }),
        );
      }
      byId.set(r.id, { ...base, name, price_stars, visible, publicRolloutVersion });
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
    visible: cur.lockedOwnerOnly ? false : (patch.visible === undefined ? cur.visible : Boolean(patch.visible)),
    publicRolloutVersion: id === "sham_v2" && patch.visible !== undefined ? Math.max(1, cur.publicRolloutVersion || 0) : cur.publicRolloutVersion,
    price_stars: patch.price_stars === undefined ? cur.price_stars : cleanStars(patch.price_stars),
    name: { ar: String(patch.name?.ar ?? cur.name.ar).slice(0, 40), en: String(patch.name?.en ?? cur.name.en).slice(0, 40) },
  };
  await ensureTable(db);
  await db.exec(
    `INSERT INTO coder_models (id, data) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    id, JSON.stringify({ name: next.name, price_stars: next.price_stars, visible: next.visible, publicRolloutVersion: next.publicRolloutVersion }),
  );
  return next;
}

/** Can this model answer right now (its Studio / key is set)? A model that is switched on for everyone but is not ready is still hidden from users. */
/** Older chats may hold the id of the former "Sham (advanced)" entry: it was merged into the old Sham (which now has everything it had). */
export const canonModelId = (id: string | undefined): string | undefined => (id === "sham_loop" ? "sham" : id === "nova2" ? "coder" : id);   // Nova 1 was removed (2026-11-22): the one Nova is the 35B model; an old "nova2" pick means it

/** Is a model-server token present (the Studios Sham runs on share the platform token)? Read from the environment here so the model list needs nothing from Sham's code. */
const studioTokenSet = (): boolean => Boolean((process.env.MODELSCOPE_API_TOKEN || process.env.MODELSCOPE_TOKEN || "").trim());
/** The model id Nova's own engine is given: Sham models are never served by Nova's engine (they run on Sham's own path), so they map to Nova's default. */
export const novaModelOf = (id: string | undefined): string | undefined => (id === "sham" || id === "sham_v2" || id === "sham_loop" || id === "sham_probe" ? undefined : id);

export function modelReady(m: CoderModel): boolean {
  if (m.isDefault) return true;
  if (m.id === "sham" || m.id === "sham_v2") return studioTokenSet();
  if (m.id === "freei") return Boolean(secretCached("AI_GITHUB_TOKEN"));   // env or the secret stored from the Athar bot (src/lib/hostedSecrets.ts)
  if (m.id === "nova2") return nova2TokenSet() && nova2Urls().length > 0;
  return Boolean(m.serveEnv && (process.env[m.serveEnv] || "").trim());
}
const openToUsers = (m: CoderModel): boolean => !m.lockedOwnerOnly && m.visible && modelReady(m);
/** THE access check for a model, used by the bot and the Mini App alike: the owner may use every model; anyone else only a model the owner switched on for everyone AND that is ready. */
export const modelUsableBy = (m: CoderModel, owner: boolean): boolean => owner || openToUsers(m);

/** Whether a public chat is selected on Sham's independent runtime and may use it right now.
 * This access check must not depend on Nova's separate coder Studio being configured or online. */
export function publicShamSelection(id: string | undefined, models: CoderModel[]): boolean {
  const canonical = canonModelId(id);
  if (canonical !== "sham" && canonical !== "sham_v2") return false;
  const selected = models.find((m) => m.id === canonical);
  return Boolean(selected && modelUsableBy(selected, false));
}

/** Who can use this model right now, in words the owner panel shows (never hides a reason). */
export type ModelAccess = "everyone" | "owner_only" | "on_but_not_ready";
export function modelAccess(m: CoderModel): ModelAccess {
  if (!m.visible) return "owner_only";
  return modelReady(m) ? "everyone" : "on_but_not_ready";
}

/** The model a chat may use: its pick if still visible (the owner may use hidden ones to test), else the default. */
export function effectiveModel(models: CoderModel[], picked: string | undefined, owner: boolean): CoderModel {
  const m = models.find((x) => x.id === canonModelId(picked));
  if (m && (owner || openToUsers(m))) return m;
  return (!owner && models.find((x) => openToUsers(x) && x.isDefault)) || (!owner && models.find(openToUsers)) || models.find((x) => x.isDefault) || models[0];
}

export type PublicModel = { id: string; name: { ar: string; en: string }; desc: { ar: string; en: string }; price_stars: number | null; selected: boolean };
export function publicModels(models: CoderModel[], picked: string | undefined): PublicModel[] {
  const sel = effectiveModel(models, picked, false).id;
  return models.filter(openToUsers).map((m) => ({ id: m.id, name: m.name, desc: m.desc, price_stars: m.price_stars, selected: m.id === sel }));
}

/** Owner view: every model, its switch, its price, and whether its serving address is set (never the address itself). */
export function ownerModels(models: CoderModel[], picked: string | undefined) {
  const sel = effectiveModel(models, picked, true).id;
  return models.map((m) => ({ id: m.id, name: m.name, desc: m.desc, price_stars: m.price_stars, visible: m.visible, isDefault: Boolean(m.isDefault), selected: m.id === sel, ready: modelReady(m), access: modelAccess(m) }));
}

/** A non-owner chat whose current model is not available to users any more (the owner hid it) is moved to the first model users can use; "blocked" = no model is open to users at all.
 *  The owner is never moved. Used by the bot and by the Mini App's send, so the owner's switch holds everywhere. */
export function ensureUsableModel(st: { model?: string; mode: "coder" | "sham" }, models: CoderModel[], owner: boolean): "ok" | "moved" | "blocked" {
  if (owner) return "ok";
  const cur = models.find((m) => m.id === (canonModelId(st.model) || DEFAULT_MODEL_ID));
  if (cur && openToUsers(cur)) return "ok";
  const alt = models.find(openToUsers);
  if (!alt) return "blocked";
  return chooseModel(st, models, alt.id, false) ? "moved" : "blocked";
}

/** The ONE way a chat changes model (Mini App picker and the bot's buttons both end here): the chosen model is the single source of
 *  truth, and the old Nova/Sham section follows from it. Returns false when this person may not use that model. */
export function chooseModel(st: { model?: string; mode: "coder" | "sham"; freei?: boolean }, models: CoderModel[], id: string, owner: boolean): boolean {
  const m = models.find((x) => x.id === canonModelId(id));
  if (!m || !(owner || openToUsers(m))) return false;
  // "free i" is a switch only: it never becomes the chat's model and never reaches Nova's tools, Studios, settings or chats. Only a flag marks it.
  if (m.id === "freei") { if (!owner) return false; st.freei = true; return true; }
  st.freei = false;
  if ((m.id === "sham" || m.id === "sham_v2") && !studioTokenSet()) return false;                // they need the Studio token
  st.model = m.id;
  st.mode = m.id === "sham" || m.id === "sham_v2" ? "sham" : "coder";   // Sham (old and new) runs on its OWN path, separate from Nova's engine, tools and Studios
  return true;
}

// ---------------------------------------------------------------- per-model settings (Mini App → settings): strictly the selected model's own
/** Thinking, speed (accuracy) and media generation are set PER MODEL: changing one model's switches never changes another's. */
export type ModelSettings = { think: boolean; accuracy: "fast" | "balanced" | "precise"; media: boolean; auto: boolean; policy: "adaptive" | "always" | "never" };   // auto (default on) = each request picks its own mode from the user's preference (src/lib/modes.ts)
export type PerModelState = { model?: string; think?: boolean; accuracy?: string; perModel?: Record<string, Partial<ModelSettings>> };
const isAcc = (x: unknown): x is ModelSettings["accuracy"] => x === "fast" || x === "balanced" || x === "precise";   // "accurate" is accepted as "precise" by the API (modes.ts normalizePref)
/** The effective settings of one model. Nova (id "coder") also honours the old single global switches until it has its own entry; every other model starts from the defaults. */
export function modelSettings(_st: PerModelState, _id: string | undefined): ModelSettings {
  // Owner 2026-11-22: the models are AUTOMATIC in every function, so the Mini App has no thinking / speed / media / memory controls. The request class decides within "balanced"
  // (src/lib/modes.ts): thinking adaptive, accuracy balanced, media always on. A value stored by the old settings screens is ignored, so a hidden setting can never surprise a user.
  return { think: false, accuracy: "balanced", media: true, auto: true, policy: "adaptive" };
}
/** Kept for older clients: the settings are automatic now, so a request to change them changes nothing and returns the automatic values. */
export function setModelSettings(st: PerModelState, id: string, _patch: Partial<ModelSettings> = {}): ModelSettings {
  return modelSettings(st, id);
}

// ---------------------------------------------------------------- memory / save settings, per model
/** What a model may keep about the user: `remember` = learn lasting facts from chats, `recall` = use what was learned in answers, `save` = keep the conversations in the chat list.
 *  Each model has its own three switches (all on by default, as before); the server-wide kill switches (CODER_MEMORY=off, SHAM_MEMORY=off) still win. */
export type MemorySettings = { remember: boolean; recall: boolean; save: boolean };
export type MemoryState = { memPer?: Record<string, Partial<MemorySettings>> };
export function memorySettings(st: MemoryState, id: string | undefined): MemorySettings {
  const m = st.memPer?.[canonModelId(id) || DEFAULT_MODEL_ID] || {};
  return { remember: m.remember !== false, recall: m.recall !== false, save: m.save !== false };
}
export function setMemorySettings(st: MemoryState, id: string, patch: Partial<MemorySettings>): MemorySettings {
  const mid = canonModelId(id) || DEFAULT_MODEL_ID;
  const cur = memorySettings(st, mid);
  const next: MemorySettings = { remember: typeof patch.remember === "boolean" ? patch.remember : cur.remember, recall: typeof patch.recall === "boolean" ? patch.recall : cur.recall, save: typeof patch.save === "boolean" ? patch.save : cur.save };
  st.memPer = { ...(st.memPer || {}), [mid]: next };
  return next;
}

// ---------------------------------------------------------------- T-LDM (Sham Pro, Nova 1, Nova 2)
/** Audience gates live in src/lib/tldmPolicy.ts, PER MODEL (env SHAM_/NOVA1_/NOVA2_TLDM_OPEN or that model's stored switch). */
export { tldmOpenToAll, tldmAllowedFor, TLDM_MODELS, isTldmModel } from "@/lib/tldmPolicy";
import { isTldmModel } from "@/lib/tldmPolicy";
/** Per-chat T-LDM switch, PER MODEL: each of Sham Pro / Nova 1 / Nova 2 has its own, and one never enables another.
 *  Sham 1 (the old body) has none. Enabling a model's switch still requires tldmAllowedFor(tier, that model). */
export type TldmState = { perModel?: Record<string, { tldm?: boolean } & Record<string, unknown>> };
export function tldmEnabled(st: TldmState, id?: string): boolean {
  const m = canonModelId(id);
  if (!isTldmModel(m)) return false;
  // automatic (owner, 2026-11-22): no switch; an account's own explicit /tldm on|off in the bot still wins.
  const own = st.perModel?.[m]?.tldm;
  if (typeof own === "boolean") return own;
  // Nova's head runs in its Studio only while that Studio serves it (NOVA_TLDM=1 there). Until the same flag is set on the app side, every Nova step would pay an
  // extra Studio call that answers "body", so Nova stays on its own plain chat. Sham Pro is automatic.
  return m === "sham_v2" ? true : (process.env.NOVA_TLDM || "").trim() === "1";
}
export function setTldmEnabled(st: TldmState, on: boolean, id?: string): boolean {
  const m = canonModelId(id) || "sham_v2";
  if (!isTldmModel(m)) return false;
  const cur = st.perModel?.[m] || {};
  st.perModel = { ...(st.perModel || {}), [m]: { ...cur, tldm: Boolean(on) } };
  return Boolean(on);
}
