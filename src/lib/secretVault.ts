/**
 * Secret box (owner's order 2026-11-13): the user hands the model a password / token / account WITHOUT writing it in the chat.
 *
 *  - The model never sees a value. It asks for one by NAME (request_secret) and later uses the reference `{{secret:name}}` inside a tool argument; the server swaps in the value
 *    only at the moment the tool runs (resolveSecrets) and replaces the value with the reference again in whatever the tool printed (scrubSecrets), so neither the chat history,
 *    the task log nor the model's next prompt ever holds it.
 *  - Values live only in this server process, encrypted (AES-256-GCM) with a key that exists only in memory (or SECRET_VAULT_KEY if the owner sets one), per chat, with a time limit
 *    (default 60 minutes, max 8 hours). A restart forgets them: the model simply asks again. Nothing is written to the database or to a log.
 */
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

const NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{1,39}$/;
const MAX_VALUE = 4000;
const DEFAULT_TTL_MS = 60 * 60 * 1000;
const MAX_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_PER_CHAT = 20;
const REF_RE = /\{\{\s*secret:([A-Za-z][A-Za-z0-9_-]{1,39})\s*\}\}/g;

type Entry = { iv: Buffer; tag: Buffer; data: Buffer; expires: number; label: string };

const store = new Map<string, Map<string, Entry>>();
let memoryKey: Buffer | null = null;

function key(): Buffer {
  const env = process.env.SECRET_VAULT_KEY;
  if (env) return createHash("sha256").update(env).digest();
  if (!memoryKey) memoryKey = randomBytes(32);
  return memoryKey;
}

function chatMap(chatId: number | string): Map<string, Entry> {
  const k = String(chatId);
  let m = store.get(k);
  if (!m) { m = new Map(); store.set(k, m); }
  return m;
}

function sweep(m: Map<string, Entry>, now = Date.now()): void {
  for (const [n, e] of m) if (e.expires <= now) m.delete(n);
}

export function isSecretName(name: unknown): name is string {
  return typeof name === "string" && NAME_RE.test(name);
}

export function putSecret(chatId: number | string, name: string, value: string, opts: { ttlMs?: number; label?: string } = {}): { ok: true; name: string; expiresAt: number } {
  if (!isSecretName(name)) throw new Error("bad secret name (letters, digits, - and _; 2-40 characters, starts with a letter)");
  const v = String(value ?? "");
  if (!v || v.length > MAX_VALUE) throw new Error("the secret is empty or too long");
  const m = chatMap(chatId);
  sweep(m);
  if (!m.has(name) && m.size >= MAX_PER_CHAT) throw new Error("too many secrets in this chat");
  const ttl = Math.max(60_000, Math.min(MAX_TTL_MS, Number(opts.ttlMs) || DEFAULT_TTL_MS));
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(v, "utf8"), c.final()]);
  const expires = Date.now() + ttl;
  m.set(name, { iv, tag: c.getAuthTag(), data, expires, label: String(opts.label || "").slice(0, 80) });
  return { ok: true, name, expiresAt: expires };
}

function open(e: Entry): string {
  const d = createDecipheriv("aes-256-gcm", key(), e.iv);
  d.setAuthTag(e.tag);
  return Buffer.concat([d.update(e.data), d.final()]).toString("utf8");
}

/** Names (never values) the chat holds right now, for the UI and for the model's prompt. */
export function listSecretNames(chatId: number | string): Array<{ name: string; label: string; expiresAt: number }> {
  const m = store.get(String(chatId));
  if (!m) return [];
  sweep(m);
  return [...m].map(([name, e]) => ({ name, label: e.label, expiresAt: e.expires }));
}

export function hasSecret(chatId: number | string, name: string): boolean {
  const m = store.get(String(chatId));
  if (!m) return false;
  sweep(m);
  return m.has(name);
}

export function deleteSecret(chatId: number | string, name: string): boolean {
  return store.get(String(chatId))?.delete(name) ?? false;
}

export function clearSecrets(chatId: number | string): void {
  store.delete(String(chatId));
}

/** Swap every {{secret:name}} in a string for its value. Unknown / expired names throw, naming only the reference, so the model asks again. */
export function resolveSecrets(chatId: number | string, text: string): string {
  if (typeof text !== "string" || !text.includes("secret:")) return text;
  const m = store.get(String(chatId));
  if (m) sweep(m);
  return text.replace(REF_RE, (_all, name: string) => {
    const e = m?.get(name);
    if (!e) throw new Error(`the secret "${name}" is not in the secret box (ask the user for it with request_secret)`);
    return open(e);
  });
}

/** Resolve the references inside every string of a tool-argument object (deeply), returning a copy. */
export function resolveSecretsDeep<T>(chatId: number | string, value: T): T {
  if (typeof value === "string") return resolveSecrets(chatId, value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => resolveSecretsDeep(chatId, v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = resolveSecretsDeep(chatId, v);
    return out as T;
  }
  return value;
}

/** Put the references back in anything a tool printed (a page, a terminal line, an error): the value must not reach the history, the task log or the next prompt. */
export function scrubSecrets(chatId: number | string, text: string): string {
  if (typeof text !== "string" || !text) return text;
  const m = store.get(String(chatId));
  if (!m || !m.size) return text;
  sweep(m);
  let out = text;
  for (const [name, e] of m) {
    const v = open(e);
    if (v.length >= 3 && out.includes(v)) out = out.split(v).join(`{{secret:${name}}}`);
  }
  return out;
}

export function hasSecretRefs(text: string): boolean {
  REF_RE.lastIndex = 0;
  return typeof text === "string" && REF_RE.test(text);
}

export const __testing = { reset: () => store.clear() };
