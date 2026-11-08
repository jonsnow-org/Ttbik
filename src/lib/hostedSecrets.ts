// Secrets the owner adds from the bot instead of editing a server's .env (owner's order 2026-11-08: Vercel is down, the backup servers must get new secrets
// without anyone logging in to Oracle). Stored AES-256-GCM encrypted in the shared database, so every server (Oracle, Vercel, any standby) reads the same
// value; the key comes from the environment (CODER_TOKEN_KEY, else CRON_SECRET), never from the database. Only names matching ALLOWED can be stored.
// An environment variable of the same name always wins, so an existing deployment never changes behaviour. Values are never logged or returned.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { tierFor } from "@/lib/coderAuth";

export const ALLOWED = /^AI_[A-Z0-9_]{2,40}$/;

function key(env: Record<string, string | undefined> = process.env): Buffer | null {
  const k = (env.CODER_TOKEN_KEY || env.CRON_SECRET || "").trim();
  return k ? createHash("sha256").update("hosted-secrets|" + k).digest() : null;
}
export function seal(plain: string, env?: Record<string, string | undefined>): string {
  const k = key(env);
  if (!k) throw new Error("no encryption key (CODER_TOKEN_KEY or CRON_SECRET) on this server");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", k, iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["s1", iv.toString("base64"), c.getAuthTag().toString("base64"), enc.toString("base64")].join(".");
}
export function open(blob: string, env?: Record<string, string | undefined>): string | null {
  const k = key(env);
  const [v, iv, tag, data] = String(blob || "").split(".");
  if (!k || v !== "s1" || !iv || !tag || !data) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
  } catch { return null; }
}

let ready: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  ready ??= prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS hosted_secrets (name TEXT PRIMARY KEY, value_enc TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`).then(() => undefined).catch((e) => { ready = null; throw e; });
  return ready;
}
export async function setSecret(name: string, value: string): Promise<void> {
  if (!ALLOWED.test(name)) throw new Error("name not allowed");
  const blob = seal(value);
  await ensureTable();
  await prisma.$executeRawUnsafe(`INSERT INTO hosted_secrets (name, value_enc) VALUES ($1,$2) ON CONFLICT (name) DO UPDATE SET value_enc=EXCLUDED.value_enc, updated_at=now()`, name, blob);
  cache.delete(name);
}
export async function deleteSecret(name: string): Promise<void> {
  await ensureTable();
  await prisma.$executeRawUnsafe(`DELETE FROM hosted_secrets WHERE name=$1`, name);
  cache.delete(name);
}
export async function secretNames(): Promise<string[]> {
  await ensureTable();
  return ((await prisma.$queryRawUnsafe(`SELECT name FROM hosted_secrets ORDER BY name`)) as { name: string }[]).map((r) => r.name);
}
const cache = new Map<string, { v: string; at: number }>();
/** The environment variable if set, else the stored secret (cached for a minute), else "". */
export async function getSecret(name: string): Promise<string> {
  const e = (process.env[name] || "").trim();
  if (e) return e;
  if (!ALLOWED.test(name)) return "";
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < 60_000) return hit.v;
  try {
    await ensureTable();
    const rows = (await prisma.$queryRawUnsafe(`SELECT value_enc FROM hosted_secrets WHERE name=$1`, name)) as { value_enc: string }[];
    const v = (rows[0] && open(rows[0].value_enc)) || "";
    cache.set(name, { v, at: Date.now() });
    return v;
  } catch { return ""; }
}

/** Synchronous read for code that cannot await (e.g. "is this model ready"): the environment variable, else the last stored value; refreshes in the background
 *  (the stale value stays until the new one lands). Only the very first call in a fresh instance can see "" before the first refresh finishes. */
const refreshing = new Set<string>();
export function secretCached(name: string): string {
  const e = (process.env[name] || "").trim();
  if (e) return e;
  const hit = cache.get(name);
  if ((!hit || Date.now() - hit.at >= 60_000) && !refreshing.has(name)) {
    refreshing.add(name);
    void getSecret(name).finally(() => refreshing.delete(name));
  }
  return hit?.v || "";
}

// ---------- the owner's commands (Athar bot) ----------
// Entry: the Athar bot (owner check by its own owner id) — src/lib/atharBotLogic.ts.
//   /secret                       how to use it + the names stored (never the values)
//   /secret NAME VALUE            store; the message carrying the value is deleted from the chat at once
//   /secret NAME delete           remove
export function parseSecretCommand(text: string): { name?: string; value?: string } | null {
  const m = /^\/secret(?:@\w+)?(?:\s+([A-Za-z0-9_]+))?(?:\s+([\s\S]+))?$/i.exec((text || "").trim());
  return m ? { name: m[1]?.toUpperCase(), value: m[2]?.trim() } : null;
}
type Api = { sendMessage: (chatId: number, text: string) => Promise<unknown>; deleteMessage?: (chatId: number, messageId: number) => Promise<unknown> };
export async function handleSecretUpdate(bot: { api: Api }, update: any, ownerChecked?: boolean): Promise<boolean> {
  const msg = update?.message;
  const text = typeof msg?.text === "string" ? msg.text : "";
  const parsed = parseSecretCommand(text);
  const chatId = msg?.chat?.id;
  if (!parsed || !chatId || !(ownerChecked || tierFor(chatId) === "owner")) return false;
  const say = (t: string) => bot.api.sendMessage(chatId, t).catch(() => null);
  // the value must not stay in the chat: delete first, answer after
  if (parsed.value && msg.message_id) await bot.api.deleteMessage?.(chatId, msg.message_id)?.catch?.(() => null);
  if (!parsed.name) {
    const names = await secretNames().catch(() => [] as string[]);
    await say(`🔐 الأسرار · Secrets\n/secret AI_GITHUB_TOKEN <القيمة> — حفظ (تُحذف رسالتك فوراً)\n/secret AI_GITHUB_TOKEN delete — حذف\nالأسماء المسموحة: AI_*\nالمحفوظ الآن: ${names.length ? names.join(", ") : "لا شيء"}`);
    return true;
  }
  if (!ALLOWED.test(parsed.name)) { await say("هذا الاسم غير مسموح (يجب أن يبدأ بـ AI_)."); return true; }
  try {
    if (parsed.value?.toLowerCase() === "delete") { await deleteSecret(parsed.name); await say(`🗑 حُذف ${parsed.name}.`); return true; }
    if (!parsed.value) { await say(`أرسل: /secret ${parsed.name} <القيمة>`); return true; }
    await setSecret(parsed.name, parsed.value);
    await say(`✅ حُفظ ${parsed.name} (${parsed.value.length} حرفاً) مشفّراً، ويعمل على كل الخوادم بلا إعادة تشغيل. حُذفت رسالتك من المحادثة.`);
  } catch (e) {
    await say(`تعذّر الحفظ: ${String((e as Error)?.message || e).slice(0, 100)}`);
  }
  return true;
}
