/**
 * T-LDM audience and owner deny-list, PER MODEL.
 *
 * Owner's order (2026-11-22): T-LDM is automatic and ON for everybody on every model that carries a head
 * (Sham Pro, Nova); there is no switch any more. What stays is the owner's per-model deny-list (stored key
 * `tldm_deny:<model>`), which applies to every user and cannot be overridden. A model that is not a T-LDM model
 * (Sham 1's old body) is never open and inherits nothing from another model.
 * Every audience gate still goes through `tldmAllowedFor(tier, model)`.
 */
import { prismaDb, type Db } from "@/lib/coderAuth";

/** The models that can carry a T-LDM head. Sham's old body (v1) never does. */
export const TLDM_MODELS = ["sham_v2", "coder", "nova2"] as const;
export type TldmModel = (typeof TLDM_MODELS)[number];
export const isTldmModel = (m: string | undefined): m is TldmModel => m === "sham_v2" || m === "coder" || m === "nova2";

const ENV_PREFIX: Record<TldmModel, string> = { sham_v2: "SHAM", coder: "NOVA", nova2: "NOVA" };
/** Nova is ONE model now (`coder`): the old `nova2` id is a legacy alias for the SAME policy key (review note #1198 §5.9). Sham Pro stays fully separate. */
const norm = (m: string | undefined): string | undefined => (m === "nova2" ? "coder" : m);
/** The model, or "" for anything that is not a T-LDM model (it then inherits nothing). */
const keyOf = (m: string | undefined): TldmModel | "" => (isTldmModel(norm(m)) ? (norm(m) as TldmModel) : "");
const isKey = (m: string | undefined): m is TldmModel => isTldmModel(norm(m));

const TTL = 20000;
const MAX_PATTERNS = 200;
const MAX_PATTERN = 200;

type State = { open: boolean; deny: string[]; at: number };
const state = new Map<TldmModel, State>();
const get = (model: TldmModel): State => {
  const m = norm(model) as TldmModel;
  let s = state.get(m);
  if (!s) { s = { open: false, deny: [], at: 0 }; state.set(m, s); }
  return s;
};

let ready = false;
async function table(db: Db): Promise<void> {
  if (db === prismaDb && ready) return;
  await db.exec(`CREATE TABLE IF NOT EXISTS coder_flags (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  if (db === prismaDb) ready = true;
}

export function parseDenyList(raw: unknown): string[] {
  const lines = Array.isArray(raw)
    ? raw.map((x) => String(x))
    : String(raw || "").split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    const p = line.trim();
    if (!p || p.startsWith("#")) continue;
    out.push(p.slice(0, MAX_PATTERN));
    if (out.length >= MAX_PATTERNS) break;
  }
  return out;
}

/** That model's own env switch; an unknown model is never open by env. */
export function envOpen(model: string | undefined): boolean {
  if (!isKey(model)) return false;
  const m = norm(model) as TldmModel;
  const on = (name: string) => (process.env[name] || "").trim() === "1";
  // Nova: the one switch is NOVA_TLDM_OPEN; the old NOVA1_/NOVA2_ names keep working (a deploy never silently closes what the owner opened)
  return on(`${ENV_PREFIX[m]}_TLDM_OPEN`) || (m === "coder" && (on("NOVA1_TLDM_OPEN") || on("NOVA2_TLDM_OPEN")));
}

/** Always open for a T-LDM model (no switch); never open for anything else. */
export function tldmOpenToAll(model: string | undefined): boolean {
  return isKey(model);
}

export function tldmAllowedFor(tier: string | undefined, model: string | undefined): boolean {
  return tldmOpenToAll(model) || tier === "owner";
}

export function tldmOwnerDenyList(model: string | undefined): string[] {
  return isKey(model) ? get(model).deny.slice() : [];
}

/** Every model's deny-list, deduplicated: the device mesh (which is not per model) refuses any pattern any model bans. */
export function tldmOwnerDenyListAll(): string[] {
  const out = new Set<string>();
  for (const m of TLDM_MODELS) for (const p of get(m).deny) out.add(p);
  return [...out];
}

/** Hard-deny match: a line is a case-insensitive substring, or re:<regex>. */
export function tldmDeniedByOwner(command: string, patterns: string[] = []): string {
  const cmd = String(command || "");
  if (!cmd) return "";
  for (const pat of patterns) {
    if (pat.toLowerCase().startsWith("re:")) {
      try {
        if (new RegExp(pat.slice(3), "i").test(cmd)) return `owner deny-list: ${pat}`;
      } catch {
        continue;
      }
    } else if (cmd.toLowerCase().includes(pat.toLowerCase())) {
      return `owner deny-list: ${pat}`;
    }
  }
  return "";
}

export async function refreshTldmPolicy(db: Db = prismaDb, model: string | undefined, force = false): Promise<{ open: boolean; deny: string[] }> {
  const m = keyOf(model);
  if (!m) return { open: false, deny: [] };
  const s = get(m);
  if (!force && Date.now() - s.at < TTL) return { open: tldmOpenToAll(m), deny: tldmOwnerDenyList(m) };
  try {
    await table(db);
    const legacy = m === "coder" ? ["nova2"] : [];                      // rows saved while Nova had two ids are still honoured (their deny-list is merged, their open flag counts)
    const names = [m, ...legacy];
    const keys = names.flatMap((n) => [`tldm_open:${n}`, `tldm_deny:${n}`]);
    const rows = await db.query<{ key: string; value: string }>(
      `SELECT key, value FROM coder_flags WHERE key IN (${keys.map((_, i) => `$${i + 1}`).join(", ")})`, ...keys,
    );
    let stored = false;
    let deny: string[] = [];
    for (const r of rows) {
      if (names.some((n) => r.key === `tldm_open:${n}`)) stored = stored || (r.value || "").trim() === "1";
      if (names.some((n) => r.key === `tldm_deny:${n}`)) {
        let part: string[] = [];
        try { part = parseDenyList(JSON.parse(r.value)); } catch { part = parseDenyList(r.value); }
        deny = [...new Set([...deny, ...part])];
      }
    }
    s.open = stored;
    s.deny = deny;
  } catch { /* keep the last known values */ }
  s.at = Date.now();
  return { open: tldmOpenToAll(m), deny: tldmOwnerDenyList(m) };
}

export async function setTldmOpen(on: boolean, db: Db = prismaDb, model: string | undefined): Promise<{ open: boolean; deny: string[] }> {
  const m = keyOf(model);
  if (!m) return { open: false, deny: [] };
  await table(db);
  await db.exec(`INSERT INTO coder_flags (key, value, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, `tldm_open:${m}`, on ? "1" : "0");
  const s = get(m);
  s.open = Boolean(on);
  s.at = Date.now();
  return { open: tldmOpenToAll(m), deny: tldmOwnerDenyList(m) };
}

export async function setTldmOwnerDenyList(raw: unknown, db: Db = prismaDb, model: string | undefined): Promise<{ open: boolean; deny: string[] }> {
  const m = keyOf(model);
  if (!m) return { open: false, deny: [] };
  const deny = parseDenyList(raw);
  await table(db);
  await db.exec(`INSERT INTO coder_flags (key, value, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, `tldm_deny:${m}`, JSON.stringify(deny));
  const s = get(m);
  s.deny = deny;
  s.at = Date.now();
  return { open: tldmOpenToAll(m), deny: tldmOwnerDenyList(m) };
}

export const _setTldmPolicyForTests = (model: string | undefined, open: boolean, deny: string[] = []): void => {
  const m = keyOf(model);
  if (!m) return;
  const s = get(m);
  s.open = open;
  s.deny = parseDenyList(deny);
  s.at = Date.now();
};
