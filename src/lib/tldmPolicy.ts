/**
 * Sham 2 T-LDM audience and owner deny-list. Default is owner-only.
 * SHAM_TLDM_OPEN=1 (env) or the stored owner switch (coder_flags tldm_open=1) opens the
 * path to every user. All audience gates go through tldmAllowedFor.
 * The deny-list is owner-only to edit, applies to every session, and cannot be overridden
 * by a user's allow tap. Work-time policy (when open): free search/browsing and execution
 * in that user's isolated workspace; the user approves their own sensitive commands;
 * writes stay inside that workspace; the owner deny-list is a hard refuse.
 */
import { prismaDb, type Db } from "@/lib/coderAuth";

const OPEN_KEY = "tldm_open";
const DENY_KEY = "tldm_deny";
const TTL = 20000;
const MAX_PATTERNS = 200;
const MAX_PATTERN = 200;

let openCache = false;
let denyCache: string[] = [];
let at = 0;
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

export function envOpen(): boolean {
  return (process.env.SHAM_TLDM_OPEN || "").trim() === "1";
}

/** Sync: env or the last stored refresh. Call refreshTldmPolicy on the request first. */
export function tldmOpenToAll(): boolean {
  return envOpen() || openCache;
}

export function tldmAllowedFor(tier: string | undefined): boolean {
  return tldmOpenToAll() || tier === "owner";
}

export function tldmOwnerDenyList(): string[] {
  return denyCache.slice();
}

/** Hard-deny match: a line is a case-insensitive substring, or re:<regex>. */
export function tldmDeniedByOwner(command: string, patterns: string[] = tldmOwnerDenyList()): string {
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

export async function refreshTldmPolicy(db: Db = prismaDb, force = false): Promise<{ open: boolean; deny: string[] }> {
  if (!force && Date.now() - at < TTL) return { open: tldmOpenToAll(), deny: tldmOwnerDenyList() };
  try {
    await table(db);
    const rows = await db.query<{ key: string; value: string }>(`SELECT key, value FROM coder_flags WHERE key IN ($1, $2)`, OPEN_KEY, DENY_KEY);
    let stored = false;
    let deny: string[] = [];
    for (const r of rows) {
      if (r.key === OPEN_KEY) stored = (r.value || "").trim() === "1";
      if (r.key === DENY_KEY) {
        try { deny = parseDenyList(JSON.parse(r.value)); } catch { deny = parseDenyList(r.value); }
      }
    }
    openCache = stored;
    denyCache = deny;
  } catch { /* keep the last known values */ }
  at = Date.now();
  return { open: tldmOpenToAll(), deny: tldmOwnerDenyList() };
}

export async function setTldmOpen(on: boolean, db: Db = prismaDb): Promise<{ open: boolean; deny: string[] }> {
  await table(db);
  await db.exec(`INSERT INTO coder_flags (key, value, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, OPEN_KEY, on ? "1" : "0");
  openCache = Boolean(on);
  at = Date.now();
  return { open: tldmOpenToAll(), deny: tldmOwnerDenyList() };
}

export async function setTldmOwnerDenyList(raw: unknown, db: Db = prismaDb): Promise<{ open: boolean; deny: string[] }> {
  const deny = parseDenyList(raw);
  await table(db);
  await db.exec(`INSERT INTO coder_flags (key, value, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, DENY_KEY, JSON.stringify(deny));
  denyCache = deny;
  at = Date.now();
  return { open: tldmOpenToAll(), deny: tldmOwnerDenyList() };
}

export const _setTldmPolicyForTests = (open: boolean, deny: string[] = []): void => {
  openCache = open;
  denyCache = parseDenyList(deny);
  at = Date.now();
};
