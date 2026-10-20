// Who the coder works for, and with whose credentials (owner's plan, 2026-10-21).
//   tier "owner" — SUPER_ADMIN_TELEGRAM_ID / TELEGRAM_ADMIN_CHAT_ID: the owner's own token (CODER_GITHUB_TOKEN), widest freedom.
//   tier "user"  — everyone else: ONLY their own linked credentials, never the owner's.
// Per-user linking (later): a Telegram Mini App page verifies the user with verifyTelegramInitData (src/lib/verifyTelegramOwner.ts), runs the
// provider's OAuth / device flow, and calls saveConnection(). Tokens are stored AES-256-GCM encrypted (key: CODER_TOKEN_KEY) in
// coder_connections, keyed by the same salted chat hash as the chat state — never the raw id, never logged. Nothing writes there yet.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";

export type Db = { exec: (sql: string, ...args: unknown[]) => Promise<unknown>; query: <T>(sql: string, ...args: unknown[]) => Promise<T[]> };
export const prismaDb: Db = {
  exec: (sql, ...args) => prisma.$executeRawUnsafe(sql, ...args),
  query: <T,>(sql: string, ...args: unknown[]) => prisma.$queryRawUnsafe<T[]>(sql, ...args),
};

export function coderChatKey(chatId: number | string): string {
  const salt = process.env.CODER_STATE_SALT || process.env.SHAM_MEMORY_SALT || "coder-section";
  return "tgc:" + createHash("sha256").update(`${salt}|${chatId}`).digest("hex").slice(0, 32);
}

export type Tier = "owner" | "user";
export type Provider = "github";
export type Connection = { token: string; source: "owner-env" | "user-link"; login?: string };
export type Connections = Partial<Record<Provider, Connection>>;

export function ownerIds(): string[] {
  return [process.env.SUPER_ADMIN_TELEGRAM_ID, process.env.TELEGRAM_ADMIN_CHAT_ID].map((x) => (x || "").trim()).filter(Boolean);
}
export function tierFor(chatId: number | string): Tier {
  return ownerIds().includes(String(chatId)) ? "owner" : "user";
}

function key(): Buffer | null {
  const k = (process.env.CODER_TOKEN_KEY || "").trim();
  return k ? createHash("sha256").update(k).digest() : null;
}
export function encryptToken(plain: string): string {
  const k = key();
  if (!k) throw new Error("CODER_TOKEN_KEY is not set");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", k, iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), enc.toString("base64")].join(".");
}
export function decryptToken(blob: string): string | null {
  const k = key();
  const [v, iv, tag, data] = String(blob || "").split(".");
  if (!k || v !== "v1" || !iv || !tag || !data) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

let ready: Promise<void> | null = null;
function ensureTable(db: Db): Promise<void> {
  if (db !== prismaDb) return Promise.resolve();
  if (!ready) {
    ready = db
      .exec(`CREATE TABLE IF NOT EXISTS coder_connections (chat_key TEXT NOT NULL, provider TEXT NOT NULL, token_enc TEXT NOT NULL, login TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (chat_key, provider))`)
      .then(() => undefined)
      .catch((e) => {
        ready = null;
        throw e;
      });
  }
  return ready;
}

/** For the future Mini App: store one user's own token for a provider (encrypted). */
export async function saveConnection(chatId: number | string, provider: Provider, token: string, login = "", db: Db = prismaDb): Promise<void> {
  await ensureTable(db);
  await db.exec(
    `INSERT INTO coder_connections (chat_key, provider, token_enc, login, updated_at) VALUES ($1, $2, $3, $4, now()) ON CONFLICT (chat_key, provider) DO UPDATE SET token_enc = EXCLUDED.token_enc, login = EXCLUDED.login, updated_at = now()`,
    coderChatKey(chatId), provider, encryptToken(token), login,
  );
}

/** The credentials the coder may use in this chat. Owner: the owner's env token. Others: only what they linked themselves. */
export async function resolveConnections(chatId: number | string, db: Db = prismaDb): Promise<Connections> {
  const out: Connections = {};
  if (tierFor(chatId) === "owner") {
    const t = (process.env.CODER_GITHUB_TOKEN || "").trim();
    if (t) out.github = { token: t, source: "owner-env" };
    return out;
  }
  try {
    await ensureTable(db);
    const rows = await db.query<{ provider: string; token_enc: string; login: string | null }>(
      `SELECT provider, token_enc, login FROM coder_connections WHERE chat_key = $1`, coderChatKey(chatId));
    for (const r of rows) {
      const t = decryptToken(r.token_enc);
      if (t && r.provider === "github") out.github = { token: t, source: "user-link", login: r.login || undefined };
    }
  } catch {
    /* no table / no database: no linked credentials */
  }
  return out;
}
