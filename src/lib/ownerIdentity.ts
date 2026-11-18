/**
 * Platform owner identity: a list of Telegram user ids and app account ids,
 * from server config/secrets plus accounts unlocked with the owner passphrase.
 * The passphrase itself is never stored, logged, or echoed.
 */
import { createHash, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";

const STORE_KEY = "owner_ids";
const LOCK_PREFIX = "owner_unlock:";
const MAX_FAILS = 5;
const LOCK_MS = 30 * 60 * 1000;
const TTL = 20_000;

export function parseOwnerIdList(raw: unknown): string[] {
  const chunks = Array.isArray(raw) ? raw.map((x) => String(x)) : String(raw || "").split(/[\n,;]+/);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    const line = chunk.split("#")[0].trim();
    if (!line) continue;
    for (const p of line.split(/\s+/)) {
      if (!p || seen.has(p)) continue;
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}

/** Ids from server env/secrets only (no stored unlocks). */
export function configuredOwnerIds(): string[] {
  return parseOwnerIdList(
    [process.env.OWNER_IDS, process.env.OWNER_TELEGRAM_IDS, process.env.OWNER_APP_IDS, process.env.SUPER_ADMIN_TELEGRAM_ID, process.env.TELEGRAM_ADMIN_CHAT_ID]
      .filter(Boolean)
      .join("\n"),
  );
}

let stored: string[] = [];
let at = 0;

export function storedOwnerIds(): string[] {
  return stored.slice();
}

export function allOwnerIds(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of [...configuredOwnerIds(), ...stored]) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function isPlatformOwner(id: unknown): boolean {
  const s = String(id ?? "").trim();
  return Boolean(s) && allOwnerIds().includes(s);
}

/** First configured (or unlocked) id — for outbound notices only, not the only valid owner. */
export function primaryOwnerId(): string {
  return allOwnerIds()[0] || "";
}

async function flagGet(key: string): Promise<string | null> {
  try {
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS coder_flags (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const rows = await prisma.$queryRawUnsafe<Array<{ value: string }>>(`SELECT value FROM coder_flags WHERE key = $1`, key);
    return rows[0]?.value ?? null;
  } catch {
    return null;
  }
}

async function flagSet(key: string, value: string): Promise<void> {
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS coder_flags (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await prisma.$executeRawUnsafe(
    `INSERT INTO coder_flags (key, value, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    key,
    value,
  );
}

export async function refreshOwnerIds(force = false): Promise<string[]> {
  if (!force && Date.now() - at < TTL) return allOwnerIds();
  const raw = await flagGet(STORE_KEY);
  if (raw) {
    try {
      stored = parseOwnerIdList(JSON.parse(raw));
    } catch {
      stored = parseOwnerIdList(raw);
    }
  }
  at = Date.now();
  return allOwnerIds();
}

export async function addStoredOwnerId(id: string): Promise<string[]> {
  const next = String(id || "").trim();
  if (!next) return allOwnerIds();
  await refreshOwnerIds(true);
  if (!stored.includes(next)) stored.push(next);
  at = Date.now();
  try {
    await flagSet(STORE_KEY, JSON.stringify(stored));
  } catch {
    /* in-memory list still applies on this process */
  }
  return allOwnerIds();
}

function sha256buf(s: string): Buffer {
  return createHash("sha256").update(s, "utf8").digest();
}

function parseHash(raw: string): Buffer | null {
  const t = raw.trim().toLowerCase().replace(/^sha256:/, "");
  if (!/^[0-9a-f]{64}$/.test(t)) return null;
  return Buffer.from(t, "hex");
}

let loadedHash: Buffer | null | undefined;

function expectedHash(): Buffer | null {
  if (loadedHash !== undefined) return loadedHash;
  const named = parseHash(process.env.SHAM_OWNER_PASSPHRASE_HASH || "");
  if (named) {
    loadedHash = named;
    return loadedHash;
  }
  const plain = process.env.SHAM_OWNER_PASSPHRASE;
  if (plain) {
    loadedHash = sha256buf(plain);
    return loadedHash;
  }
  loadedHash = null;
  return null;
}

export function ownerPassphraseConfigured(): boolean {
  return expectedHash() != null;
}

export function normalizeUnlockMessage(text: string): string {
  return String(text || "").replace(/\r\n/g, "\n").trim();
}

/** Constant-time whole-message compare against the stored passphrase hash. Never logs the text. */
export function messageMatchesOwnerPassphrase(text: string): boolean {
  const want = expectedHash();
  if (!want) return false;
  const got = sha256buf(normalizeUnlockMessage(text));
  if (got.length !== want.length) return false;
  try {
    return timingSafeEqual(got, want);
  } catch {
    return false;
  }
}

/**
 * A guess-shaped message (for rate-limiting only). Normal chat — including Arabic
 * questions — is not a candidate, so everyday messages are never deleted or counted.
 * A matching passphrase still unlocks even when it is a sentence.
 */
export function isPassphraseCandidate(text: string): boolean {
  const t = normalizeUnlockMessage(text);
  if (t.length < 10 || t.length > 256 || t.includes("\n") || t.startsWith("/")) return false;
  if (/[؟?]/.test(t)) return false;
  if (!/\s/.test(t)) return true;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length > 6) return false;
  const ascii = (t.match(/[A-Za-z0-9._@#+=-]/g) || []).length;
  return ascii / t.length >= 0.7;
}

/** True when this text must never enter logs, chat history, experience, or training. */
export function excludeFromExperienceAndLogs(text: string): boolean {
  if (!ownerPassphraseConfigured() || !String(text || "").trim()) return false;
  return messageMatchesOwnerPassphrase(text) || isPassphraseCandidate(text);
}

function chatLockKey(chatId: string): string {
  return LOCK_PREFIX + createHash("sha256").update(`unlock|${chatId}`).digest("hex").slice(0, 16);
}

type LockState = { fails: number; until: number };
const memLock = new Map<string, LockState>();

export function resetOwnerUnlockStateForTests(): void {
  memLock.clear();
  stored = [];
  at = 0;
  loadedHash = undefined;
}

export const _setStoredOwnerIdsForTests = (ids: string[]): void => {
  stored = parseOwnerIdList(ids);
  at = Date.now();
};

async function loadLock(chatId: string): Promise<LockState> {
  const k = chatLockKey(chatId);
  const raw = await flagGet(k);
  if (raw) {
    try {
      const p = JSON.parse(raw) as LockState;
      if (p && typeof p.fails === "number") {
        memLock.set(k, p);
        return p;
      }
    } catch {
      /* ignore */
    }
  }
  return memLock.get(k) ?? { fails: 0, until: 0 };
}

async function saveLock(chatId: string, st: LockState): Promise<void> {
  const k = chatLockKey(chatId);
  memLock.set(k, st);
  try {
    await flagSet(k, JSON.stringify({ fails: st.fails, until: st.until }));
  } catch {
    /* process-local lock still applies */
  }
}

export type UnlockResult = { handled: boolean; unlocked: boolean; locked: boolean };

/**
 * If the whole private-chat message is the owner passphrase, unlock this account
 * into the stored owner list. Deletes the Telegram message. Never returns or logs the text.
 */
export async function takeOwnerPassphraseMessage(opts: {
  text: string;
  accountId: string;
  chatId: string | number;
  deleteMessage?: () => Promise<unknown>;
  reply?: (text: string) => Promise<unknown>;
}): Promise<UnlockResult> {
  const none: UnlockResult = { handled: false, unlocked: false, locked: false };
  if (!ownerPassphraseConfigured()) return none;
  const text = normalizeUnlockMessage(opts.text);
  if (!text) return none;
  await refreshOwnerIds().catch(() => null);
  const match = messageMatchesOwnerPassphrase(text);
  const candidate = isPassphraseCandidate(text);
  if (!match && !candidate) return none;

  const del = async () => {
    if (opts.deleteMessage) await opts.deleteMessage().catch(() => null);
  };
  const lock = await loadLock(String(opts.chatId));
  if (lock.until > Date.now()) {
    await del();
    await opts.reply?.("تعذّر التحقق الآن. حاول لاحقاً.").catch(() => null);
    return { handled: true, unlocked: false, locked: true };
  }
  if (match) {
    await del();
    const account = String(opts.accountId || "").trim();
    const chat = String(opts.chatId || "").trim();
    if (account) await addStoredOwnerId(account);
    if (chat && chat !== account) await addStoredOwnerId(chat);
    await saveLock(String(opts.chatId), { fails: 0, until: 0 });
    await opts.reply?.("تم فتح صلاحيات المالك لهذا الحساب.").catch(() => null);
    return { handled: true, unlocked: true, locked: false };
  }
  await del();
  const fails = lock.fails + 1;
  if (fails >= MAX_FAILS) {
    await saveLock(String(opts.chatId), { fails, until: Date.now() + LOCK_MS });
    await opts.reply?.("تعذّر التحقق الآن. حاول لاحقاً.").catch(() => null);
    return { handled: true, unlocked: false, locked: true };
  }
  await saveLock(String(opts.chatId), { fails, until: 0 });
  return { handled: true, unlocked: false, locked: false };
}

/** Strip passphrase material from an update before any log or error report. */
export function redactOwnerPassphraseInUpdate(body: unknown): unknown {
  if (!body || typeof body !== "object") return body;
  const msg = (body as { message?: { text?: unknown; caption?: unknown } }).message;
  if (!msg || typeof msg !== "object") return body;
  const copy = { ...(body as Record<string, unknown>), message: { ...msg } } as { message: { text?: unknown; caption?: unknown } };
  for (const field of ["text", "caption"] as const) {
    const v = msg[field];
    if (typeof v === "string" && excludeFromExperienceAndLogs(v)) copy.message[field] = "[redacted]";
  }
  return copy;
}
