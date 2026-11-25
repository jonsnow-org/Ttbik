/**
 * Promotion supervisor (owner only, panel switch `tg_promo`: off | owner, default off).
 *
 * The owner registers OUR projects (bots, store, jobs board…) with their links, and the bot posts short, varied promo messages for them
 * into Telegram groups where THE BOT ITSELF is a member. Plain facts this design is built on:
 *  - Telegram Business (Secretary Mode) only reaches the linked account's PRIVATE chats (`business_message`). It gives no way to post in
 *    groups as the user, so a group post here is always sent by the bot (@NovaAI_sy_bot), never by the owner's personal account.
 *  - No userbot / MTProto / client-library session is ever used. The Bot API can only post where the bot is a member and allowed to write.
 *  - A group becomes a target only when the bot is added to it (`my_chat_member`); it starts DISABLED with links NOT allowed. The owner
 *    confirms per group that the group's rules allow links, and sets the cadence. A group whose description forbids links is blocked.
 *  - Anti-spam: one post per tick, a global gap between any two posts, a daily cap, per-group cadence (min 6 h) with jitter, a per-group
 *    daily limit, quiet hours (Europe/Istanbul), no project repeated in the same group within 7 days, never the same text twice in a group.
 *    Telegram's 429 `retry_after` pauses everything; a kick / lost right disables the group and tells the owner.
 *  - Local-first: the text is written by our own Nova Studio (no external API); if it does not answer or its text fails the checks, a
 *    built-in template is used. The log records which one wrote each post.
 */
import { createHash } from "crypto";
import { prismaDb, ownerIds, tierFor, type Db } from "@/lib/coderAuth";

export type Project = { id: number; title: string; link: string; pitch: string; enabled: boolean };
export type MemberStatus = "member" | "administrator" | "restricted" | "left" | "kicked" | "unknown";
export type Target = {
  chatId: string; botId: string; title: string; username: string; type: string; status: MemberStatus; addedBy: string;
  allowLinks: boolean; enabled: boolean; cadenceH: number; maxPerDay: number; quietFrom: number; quietTo: number;
  lastPostAt: string | null; nextAt: string | null; note: string;
};
export type LogStatus = "sent" | "skip" | "fail" | "info";
export type PromoLog = { at: string; chatId: string; projectId: number | null; status: LogStatus; text: string; note: string; composer: string; hash: string };

export const LIMITS = {
  minCadenceH: 6, maxCadenceH: 168, defCadenceH: 24,
  maxPerDayCap: 3, defMaxPerDay: 1,
  globalGapMin: 15,            // minutes between any two posts, all groups together
  globalDailyCap: 20,          // posts per 24 h, all groups together
  dedupDays: 7,                // the same project is not posted twice in one group within this window
  jitter: 0.25,                // next post = cadence × (1 + random 0..25 %)
  defQuietFrom: 23, defQuietTo: 9,
  maxText: 700,
};
export const TZ = "Europe/Istanbul";

// ---------------------------------------------------------------- validation
export function normLink(raw: unknown): string {
  let s = String(raw ?? "").trim();
  if (/^@[A-Za-z][A-Za-z0-9_]{3,31}$/.test(s)) s = `https://t.me/${s.slice(1)}`;
  if (/^t\.me\//i.test(s)) s = `https://${s}`;
  let u: URL;
  try { u = new URL(s); } catch { throw new Error("bad link"); }
  if (u.protocol !== "https:") throw new Error("link must be https");
  if (s.length > 300) throw new Error("link too long");
  return u.toString().replace(/\/$/, "");
}
const clampInt = (v: unknown, lo: number, hi: number, def: number): number => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
};
export function normProject(p: any): Omit<Project, "id"> {
  const title = String(p?.title ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!title) throw new Error("title required");
  return { title, link: normLink(p?.link), pitch: String(p?.pitch ?? "").trim().slice(0, 500), enabled: p?.enabled !== false };
}
/** Only the owner-editable fields of a target, clamped to the safe ranges. */
export function normTargetSettings(t: any): Partial<Pick<Target, "allowLinks" | "enabled" | "cadenceH" | "maxPerDay" | "quietFrom" | "quietTo">> {
  const out: any = {};
  if (t?.allowLinks !== undefined) out.allowLinks = Boolean(t.allowLinks);
  if (t?.enabled !== undefined) out.enabled = Boolean(t.enabled);
  if (t?.cadenceH !== undefined) out.cadenceH = clampInt(t.cadenceH, LIMITS.minCadenceH, LIMITS.maxCadenceH, LIMITS.defCadenceH);
  if (t?.maxPerDay !== undefined) out.maxPerDay = clampInt(t.maxPerDay, 1, LIMITS.maxPerDayCap, LIMITS.defMaxPerDay);
  if (t?.quietFrom !== undefined) out.quietFrom = clampInt(t.quietFrom, 0, 23, LIMITS.defQuietFrom);
  if (t?.quietTo !== undefined) out.quietTo = clampInt(t.quietTo, 0, 23, LIMITS.defQuietTo);
  return out;
}

/** Phrases in a group's description that mean "no links / no ads". Such a group is never posted to. */
const NO_LINKS = [
  /no\s+(links?|ads|advertis\w*|promo\w*|spam)/i, /links?\s+(are\s+)?(not\s+allowed|forbidden|prohibited)/i,
  /ممنوع\s*(نشر\s*)?(ال)?(روابط|رابط|إعلان|اعلان|إعلانات|اعلانات|ترويج|تسويق)/, /(يمنع|يُمنع|منع)\s*(نشر\s*)?(ال)?(روابط|رابط|إعلان|اعلان|إعلانات|اعلانات|ترويج|تسويق)/,
  /(لا|بدون)\s*(روابط|إعلانات|اعلانات|ترويج)/,
];
export const forbidsLinks = (description: string): boolean => NO_LINKS.some((r) => r.test(String(description || "")));

export function hourIn(now: Date, tz = TZ): number {
  const h = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(now);
  return Number(h) % 24;
}
export function inQuiet(now: Date, from: number, to: number): boolean {
  if (from === to) return false;
  const h = hourIn(now);
  return from < to ? h >= from && h < to : h >= from || h < to;
}
export const textHash = (t: string): string => createHash("sha1").update(String(t).replace(/\s+/g, " ").trim().toLowerCase()).digest("hex").slice(0, 16);

// ---------------------------------------------------------------- storage (interface + SQL; tests use the in-memory one)
export interface Store {
  projects(): Promise<Project[]>;
  addProject(p: Omit<Project, "id">): Promise<Project>;
  updateProject(id: number, p: Partial<Omit<Project, "id">>): Promise<void>;
  deleteProject(id: number): Promise<void>;
  targets(): Promise<Target[]>;
  target(chatId: string): Promise<Target | null>;
  putTarget(t: Target): Promise<void>;
  deleteTarget(chatId: string): Promise<void>;
  log(row: Omit<PromoLog, "at"> & { at?: string }): Promise<void>;
  logs(limit: number, chatId?: string): Promise<PromoLog[]>;
  getState(key: string): Promise<string>;
  setState(key: string, value: string): Promise<void>;
  /** One tick at a time across servers (the GitHub scheduler and the Oracle sweeper can call in the same minute). */
  claimTick(nowMs: number, holdMs: number): Promise<boolean>;
}

export function memoryStore(): Store & { _logs: PromoLog[] } {
  const P = new Map<number, Project>(); const T = new Map<string, Target>(); const S = new Map<string, string>(); const L: PromoLog[] = [];
  let seq = 0;
  return {
    _logs: L,
    async projects() { return [...P.values()].map((p) => ({ ...p })); },
    async addProject(p) { const r = { id: ++seq, ...p }; P.set(r.id, r); return { ...r }; },
    async updateProject(id, p) { const o = P.get(id); if (o) P.set(id, { ...o, ...p }); },
    async deleteProject(id) { P.delete(id); },
    async targets() { return [...T.values()].map((t) => ({ ...t })); },
    async target(id) { const t = T.get(id); return t ? { ...t } : null; },
    async putTarget(t) { T.set(t.chatId, { ...t }); },
    async deleteTarget(id) { T.delete(id); },
    async log(r) { L.push({ at: r.at || new Date().toISOString(), chatId: r.chatId, projectId: r.projectId, status: r.status, text: r.text, note: r.note, composer: r.composer, hash: r.hash }); },
    async logs(limit, chatId) { return L.filter((r) => !chatId || r.chatId === chatId).slice().sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit); },
    async getState(k) { return S.get(k) || ""; },
    async setState(k, v) { S.set(k, v); },
    async claimTick(nowMs, holdMs) { const l = Number(S.get("lock") || 0); if (l > nowMs - holdMs && l <= nowMs) return false; S.set("lock", String(nowMs)); return true; },
  };
}

let ready = false;
export function sqlStore(db: Db = prismaDb): Store {
  const tables = async () => {
    if (db === prismaDb && ready) return;
    await db.exec(`CREATE TABLE IF NOT EXISTS promo_projects (id BIGSERIAL PRIMARY KEY, title TEXT NOT NULL, link TEXT NOT NULL, pitch TEXT NOT NULL DEFAULT '', enabled BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await db.exec(`CREATE TABLE IF NOT EXISTS promo_targets (chat_id TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await db.exec(`CREATE TABLE IF NOT EXISTS promo_log (id BIGSERIAL PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT now(), chat_id TEXT NOT NULL, project_id BIGINT, status TEXT NOT NULL, text TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', composer TEXT NOT NULL DEFAULT '', hash TEXT NOT NULL DEFAULT '')`);
    await db.exec(`CREATE INDEX IF NOT EXISTS promo_log_chat ON promo_log (chat_id, at DESC)`);
    await db.exec(`CREATE TABLE IF NOT EXISTS coder_flags (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    if (db === prismaDb) ready = true;
  };
  const proj = (r: any): Project => ({ id: Number(r.id), title: String(r.title), link: String(r.link), pitch: String(r.pitch || ""), enabled: Boolean(r.enabled) });
  const tgt = (r: any): Target => ({ ...(typeof r.data === "string" ? JSON.parse(r.data) : r.data), chatId: String(r.chat_id) });
  return {
    async projects() { await tables(); return (await db.query<any>(`SELECT * FROM promo_projects ORDER BY id`)).map(proj); },
    async addProject(p) { await tables(); const r = await db.query<any>(`INSERT INTO promo_projects (title, link, pitch, enabled) VALUES ($1, $2, $3, $4) RETURNING *`, p.title, p.link, p.pitch, p.enabled); return proj(r[0]); },
    async updateProject(id, p) {
      await tables();
      const cur = (await db.query<any>(`SELECT * FROM promo_projects WHERE id = $1`, id))[0];
      if (!cur) throw new Error("no such project");
      const n = { ...proj(cur), ...p };
      await db.exec(`UPDATE promo_projects SET title = $1, link = $2, pitch = $3, enabled = $4 WHERE id = $5`, n.title, n.link, n.pitch, n.enabled, id);
    },
    async deleteProject(id) { await tables(); await db.exec(`DELETE FROM promo_projects WHERE id = $1`, id); },
    async targets() { await tables(); return (await db.query<any>(`SELECT chat_id, data FROM promo_targets ORDER BY updated_at DESC`)).map(tgt); },
    async target(id) { await tables(); const r = await db.query<any>(`SELECT chat_id, data FROM promo_targets WHERE chat_id = $1`, id); return r[0] ? tgt(r[0]) : null; },
    async putTarget(t) { await tables(); await db.exec(`INSERT INTO promo_targets (chat_id, data, updated_at) VALUES ($1, $2::jsonb, now()) ON CONFLICT (chat_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`, t.chatId, JSON.stringify(t)); },
    async deleteTarget(id) { await tables(); await db.exec(`DELETE FROM promo_targets WHERE chat_id = $1`, id); },
    async log(r) {
      await tables();
      await db.exec(`INSERT INTO promo_log (chat_id, project_id, status, text, note, composer, hash) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        r.chatId, r.projectId, r.status, String(r.text || "").slice(0, 2000), String(r.note || "").slice(0, 300), r.composer, r.hash);
    },
    async logs(limit, chatId) {
      await tables();
      const rows = chatId
        ? await db.query<any>(`SELECT * FROM promo_log WHERE chat_id = $1 ORDER BY at DESC, id DESC LIMIT $2`, chatId, limit)
        : await db.query<any>(`SELECT * FROM promo_log ORDER BY at DESC, id DESC LIMIT $1`, limit);
      return rows.map((r) => ({ at: new Date(r.at).toISOString(), chatId: String(r.chat_id), projectId: r.project_id == null ? null : Number(r.project_id), status: r.status, text: String(r.text || ""), note: String(r.note || ""), composer: String(r.composer || ""), hash: String(r.hash || "") }));
    },
    async getState(k) { await tables(); const r = await db.query<{ value: string }>(`SELECT value FROM coder_flags WHERE key = $1`, `promo:${k}`); return r[0]?.value || ""; },
    async setState(k, v) { await tables(); await db.exec(`INSERT INTO coder_flags (key, value, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, `promo:${k}`, v); },
    async claimTick(nowMs, holdMs) {
      await tables();
      const r = await db.query<{ key: string }>(
        `INSERT INTO coder_flags (key, value, updated_at) VALUES ('promo:lock', $1, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
         WHERE coder_flags.value ~ '^[0-9]+$' AND (coder_flags.value::bigint < $2 OR coder_flags.value::bigint > $3) RETURNING key`,
        String(nowMs), nowMs - holdMs, nowMs,
      );
      return r.length > 0;
    },
  };
}

// ---------------------------------------------------------------- targets: the bot is added to / removed from a group
export const newTarget = (chatId: string, botId: string): Target => ({
  chatId, botId, title: "", username: "", type: "", status: "unknown", addedBy: "", allowLinks: false, enabled: false,
  cadenceH: LIMITS.defCadenceH, maxPerDay: LIMITS.defMaxPerDay, quietFrom: LIMITS.defQuietFrom, quietTo: LIMITS.defQuietTo, lastPostAt: null, nextAt: null, note: "",
});
const statusOf = (s: unknown): MemberStatus => (["member", "administrator", "restricted", "left", "kicked"].includes(String(s)) ? (String(s) as MemberStatus) : s === "creator" ? "administrator" : "unknown");
const canWrite = (s: MemberStatus): boolean => s === "member" || s === "administrator" || s === "restricted";

type RawApi = { raw: Record<string, (p?: Record<string, unknown>) => Promise<unknown>> };

/**
 * `my_chat_member` for a group / supergroup / channel. Joining registers the group (disabled, links not allowed); leaving or being removed
 * disables it. The owner is told only when HE added or removed the bot (anyone else adding it never reaches his chat). Never throws.
 */
export async function handleMyChatMember(api: RawApi, upd: any, botId: string, store: Store = sqlStore()): Promise<"registered" | "updated" | "ignored"> {
  try {
    const chat = upd?.chat;
    const type = String(chat?.type || "");
    if (!chat || !["group", "supergroup", "channel"].includes(type)) return "ignored";
    const chatId = String(chat.id);
    const status = statusOf(upd?.new_chat_member?.status);
    const by = String(upd?.from?.id ?? "");
    const old = await store.target(chatId);
    const t = old || newTarget(chatId, botId);
    t.botId = botId; t.title = String(chat.title || t.title || "").slice(0, 120); t.username = String(chat.username || t.username || ""); t.type = type; t.status = status;
    if (!old) t.addedBy = by;
    if (!canWrite(status)) { t.enabled = false; t.note = status === "kicked" ? "the bot was removed from the group" : "the bot left the group"; }
    else if (upd?.new_chat_member?.status === "restricted" && upd?.new_chat_member?.can_send_messages === false) { t.enabled = false; t.note = "the bot may not send messages here"; }
    else if (!old) t.note = "new: confirm that the group's rules allow links, then enable";
    await store.putTarget(t);
    await store.log({ chatId, projectId: null, status: "info", text: "", note: `bot status: ${status} (by ${by || "?"})`, composer: "", hash: "" });
    if (by && tierFor(by) === "owner") {
      const name = t.title || chatId;
      const text = canWrite(status)
        ? `📣 أُضيف البوت إلى «${name}». سُجِّلت مجموعة ترويج مُعطّلة.\nافتح التطبيق المصغّر ← لوحة المالك ← الترويج، وأكّد أن قوانين المجموعة تسمح بالروابط ثم فعّلها.`
        : `📣 خرج البوت من «${name}»؛ أُوقف النشر فيها.`;
      await api.raw.sendMessage({ chat_id: Number(by), text }).catch(() => null);
    }
    return old ? "updated" : "registered";
  } catch { return "ignored"; }
}

/** Ask Telegram whether the bot can still write in this group, and refresh title / description rules. */
export async function verifyTarget(api: RawApi, t: Target, botUserId: number): Promise<{ ok: boolean; note: string; t: Target }> {
  const n = { ...t };
  try {
    const chat = (await api.raw.getChat({ chat_id: Number(t.chatId) || t.chatId })) as any;
    n.title = String(chat?.title || n.title || "").slice(0, 120); n.username = String(chat?.username || n.username || ""); n.type = String(chat?.type || n.type);
    if (forbidsLinks(String(chat?.description || ""))) { n.allowLinks = false; n.enabled = false; n.note = "the group's description forbids links/ads"; return { ok: false, note: n.note, t: n }; }
    const m = (await api.raw.getChatMember({ chat_id: Number(t.chatId) || t.chatId, user_id: botUserId })) as any;
    n.status = statusOf(m?.status);
    if (!canWrite(n.status)) { n.enabled = false; n.note = "the bot is not a member"; return { ok: false, note: n.note, t: n }; }
    if (n.status === "restricted" && m?.can_send_messages === false) { n.enabled = false; n.note = "the bot may not send messages here"; return { ok: false, note: n.note, t: n }; }
    if (n.status === "member" && chat?.permissions && chat.permissions.can_send_messages === false) { n.note = "members may not send messages here"; return { ok: false, note: n.note, t: n }; }
    if (n.type === "channel" && n.status !== "administrator") { n.enabled = false; n.note = "in a channel the bot must be an admin"; return { ok: false, note: n.note, t: n }; }
    return { ok: true, note: "", t: n };
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    if (/kicked|not a member|chat not found|bot was blocked|have no rights|CHAT_WRITE_FORBIDDEN/i.test(msg)) { n.enabled = false; n.status = "left"; n.note = msg.slice(0, 200); }
    return { ok: false, note: msg.slice(0, 200), t: n };
  }
}

// ---------------------------------------------------------------- choosing what to post where
const sentRows = (logs: PromoLog[]) => logs.filter((l) => l.status === "sent");

export function dueTargets(targets: Target[], logs: PromoLog[], now: Date): Target[] {
  const dayAgo = now.getTime() - 86400_000;
  return targets
    .filter((t) => t.enabled && t.allowLinks && canWrite(t.status))
    .filter((t) => !inQuiet(now, t.quietFrom, t.quietTo))
    .filter((t) => !t.nextAt || Date.parse(t.nextAt) <= now.getTime())
    .filter((t) => sentRows(logs).filter((l) => l.chatId === t.chatId && Date.parse(l.at) > dayAgo).length < t.maxPerDay)
    .sort((a, b) => (Date.parse(a.nextAt || "1970-01-01") - Date.parse(b.nextAt || "1970-01-01")));
}

/** Rotation: never a project posted to this group within the dedup window; the one this group saw least recently (never = first), then the least posted overall. */
export function pickProject(projects: Project[], chatId: string, logs: PromoLog[], now: Date): Project | null {
  const sent = sentRows(logs);
  const cut = now.getTime() - LIMITS.dedupDays * 86400_000;
  const lastIn = (p: Project) => Math.max(0, ...sent.filter((l) => l.chatId === chatId && l.projectId === p.id).map((l) => Date.parse(l.at)));
  const total = (p: Project) => sent.filter((l) => l.projectId === p.id).length;
  const ok = projects.filter((p) => p.enabled && lastIn(p) < cut);
  ok.sort((a, b) => lastIn(a) - lastIn(b) || total(a) - total(b) || a.id - b.id);
  return ok[0] || null;
}

// ---------------------------------------------------------------- composing
const OPENERS = [
  "🌟 هل جرّبت {t}؟", "💡 فكرة مفيدة لك: {t}", "🚀 تعرّف على {t}", "✨ نرشّح لكم {t}", "📌 لمن يبحث عن شيء مفيد: {t}", "🔥 جديد ومجاني للتجربة: {t}",
];
const CLOSERS = ["ابدأ من هنا:", "الرابط:", "جرّبه الآن:", "للدخول:", "رابط مباشر:", "اضغط للبدء:"];
/** A built-in template, picked so that the text was not used in this group before (`used` = hashes already posted there). */
export function templateText(p: Project, used: Set<string>, seed = 0): string {
  for (let i = 0; i < OPENERS.length * CLOSERS.length; i++) {
    const k = (seed + i) % (OPENERS.length * CLOSERS.length);
    const o = OPENERS[k % OPENERS.length].replace("{t}", p.title);
    const c = CLOSERS[Math.floor(k / OPENERS.length) % CLOSERS.length];
    const text = [o, p.pitch, `${c} ${p.link}`].filter(Boolean).join("\n\n");
    if (!used.has(textHash(text))) return text;
  }
  return "";
}

/** A model-written text is accepted only if it carries the project's link, no other link or @mention, and fits. */
export function acceptComposed(text: string | null | undefined, p: Project): string {
  let t = String(text || "").trim().replace(/^["'«»]+|["'«»]+$/g, "");
  if (!t) return "";
  if (!t.includes(p.link)) t = `${t}\n\n${p.link}`;
  const urls = t.match(/(https?:\/\/|t\.me\/)\S+/gi) || [];
  const norm = (u: string) => { const x = u.replace(/[).,!؟»"']+$/, ""); return /^t\.me\//i.test(x) ? `https://${x}` : x; };
  if (urls.some((u) => !norm(u).startsWith(p.link))) return "";
  const handle = (p.link.match(/t\.me\/([A-Za-z0-9_]+)/) || [])[1]?.toLowerCase();
  const mentions = (t.match(/@[A-Za-z0-9_]{4,}/g) || []).map((m) => m.slice(1).toLowerCase());
  if (mentions.some((m) => m !== handle)) return "";
  if (t.length > LIMITS.maxText) return "";
  return t;
}

export type Compose = (p: Project, t: Target) => Promise<string | null>;
/** Our own Nova Studio writes the post (no external API). Returns null when it does not answer. */
export const novaCompose: Compose = async (p, t) => {
  const { coderChat } = await import("@/lib/openCoderStudio");
  const system = "You write ONE short Telegram promo post in Arabic (3–5 lines). Friendly, honest, no exaggeration, no fake claims, no hashtags spam (max 2), at most 3 emojis. Include the given link exactly once and no other link or @mention. Output only the post.";
  const user = `Project: ${p.title}\nWhat it does: ${p.pitch || "-"}\nLink: ${p.link}\nGroup: ${t.title || "a public Telegram group"}\nWrite a fresh variation.`;
  const o = await coderChat([{ role: "system", content: system }, { role: "user", content: user }] as never, { tools: [], maxTokens: 260, think: false, temperature: 0.9, waitS: 15, timeoutMs: 35000, model: "coder", tag: "promo" }).catch(() => null);
  const text = String((o as any)?.reply?.type === "done" ? (o as any).reply.text || "" : "").trim();
  return text || null;
};

export async function composeFor(p: Project, t: Target, logs: PromoLog[], compose: Compose | null, seed: number): Promise<{ text: string; composer: string }> {
  const used = new Set(sentRows(logs).filter((l) => l.chatId === t.chatId).map((l) => l.hash));
  if (compose) {
    const m = acceptComposed(await compose(p, t).catch(() => null), p);
    if (m && !used.has(textHash(m))) return { text: m, composer: "nova" };
  }
  return { text: templateText(p, used, seed), composer: "template" };
}

// ---------------------------------------------------------------- the tick
export type TickDeps = {
  store?: Store; now?: Date; on?: () => Promise<boolean>; compose?: Compose | null; random?: () => number;
  apiFor?: (botId: string) => Promise<{ api: RawApi; botUserId: number } | null>;
};
export type TickResult = { result: "off" | "backoff" | "gap" | "cap" | "idle" | "sent" | "skipped" | "failed"; chatId?: string; projectId?: number; note?: string };

async function defaultOn(): Promise<boolean> {
  const F = await import("@/lib/tgFeatures");
  return (await F.promoAudience()) !== "off";
}
async function defaultApiFor(botId: string): Promise<{ api: RawApi; botUserId: number } | null> {
  const { prisma } = await import("@/lib/prisma");
  const row = await prisma.bot.findUnique({ where: { id: botId } }).catch(() => null);
  if (!row?.isActive || row.template !== "NOVA_BOT") return null;
  const { Bot } = await import("grammy");
  return { api: new Bot(row.token).api as unknown as RawApi, botUserId: Number(String(row.token).split(":")[0]) };
}

/** One step of the supervisor: at most ONE post, after every check. Called every minute from the coder tick. Never throws. */
export async function runPromoTick(deps: TickDeps = {}): Promise<TickResult> {
  const store = deps.store || sqlStore();
  const now = deps.now || new Date();
  const rnd = deps.random || Math.random;
  const log = (r: Omit<PromoLog, "at">) => store.log({ ...r, at: now.toISOString() });
  try {
    if (!(await (deps.on || defaultOn)().catch(() => false))) return { result: "off" };
    if (!(await store.claimTick(now.getTime(), 50000))) return { result: "gap", note: "another tick is running" };
    const backoff = Number(await store.getState("backoff_until")) || 0;
    if (backoff > now.getTime()) return { result: "backoff" };
    const logs = await store.logs(1000);
    const sent = sentRows(logs);
    if (sent[0] && now.getTime() - Date.parse(sent[0].at) < LIMITS.globalGapMin * 60000) return { result: "gap" };
    if (sent.filter((l) => now.getTime() - Date.parse(l.at) < 86400_000).length >= LIMITS.globalDailyCap) return { result: "cap" };
    const projects = await store.projects();
    for (const t of dueTargets(await store.targets(), logs, now)) {
      const p = pickProject(projects, t.chatId, logs, now);
      if (!p) continue;
      const a = await (deps.apiFor || defaultApiFor)(t.botId).catch(() => null);
      if (!a) continue;
      const v = await verifyTarget(a.api, t, a.botUserId);
      if (!v.ok) {
        await store.putTarget(v.t);
        await log({ chatId: t.chatId, projectId: p.id, status: "skip", text: "", note: v.note, composer: "", hash: "" });
        if (!v.t.enabled && t.enabled) await notifyOwner(a.api, `⚠️ أُوقف الترويج في «${v.t.title || t.chatId}»: ${v.note}`);
        return { result: "skipped", chatId: t.chatId, note: v.note };
      }
      const { text, composer } = await composeFor(p, v.t, logs, deps.compose === undefined ? novaCompose : deps.compose, Math.floor(rnd() * 1000));
      if (!text) { await log({ chatId: t.chatId, projectId: p.id, status: "skip", text: "", note: "no fresh text left for this group", composer, hash: "" }); continue; }
      try {
        await a.api.raw.sendMessage({ chat_id: Number(t.chatId) || t.chatId, text, link_preview_options: { url: p.link, prefer_small_media: true } });
      } catch (e) {
        const msg = String((e as Error)?.message || e).slice(0, 200);
        const retry = Number((e as any)?.parameters?.retry_after ?? (msg.match(/retry after (\d+)/i) || [])[1]);
        if (retry > 0) await store.setState("backoff_until", String(now.getTime() + retry * 1000));
        const n = { ...v.t, nextAt: new Date(now.getTime() + 3600_000).toISOString() };
        if (/kicked|not enough rights|CHAT_WRITE_FORBIDDEN|chat not found|have no rights/i.test(msg)) { n.enabled = false; n.note = msg; await notifyOwner(a.api, `⚠️ أُوقف الترويج في «${n.title || t.chatId}»: ${msg}`); }
        await store.putTarget(n);
        await log({ chatId: t.chatId, projectId: p.id, status: "fail", text, note: msg, composer, hash: textHash(text) });
        return { result: "failed", chatId: t.chatId, projectId: p.id, note: msg };
      }
      const next = new Date(now.getTime() + t.cadenceH * 3600_000 * (1 + LIMITS.jitter * rnd()));
      await store.putTarget({ ...v.t, lastPostAt: now.toISOString(), nextAt: next.toISOString(), note: "" });
      await log({ chatId: t.chatId, projectId: p.id, status: "sent", text, note: p.title, composer, hash: textHash(text) });
      return { result: "sent", chatId: t.chatId, projectId: p.id };
    }
    return { result: "idle" };
  } catch (e) { return { result: "failed", note: String((e as Error)?.message || e).slice(0, 200) }; }
}

async function notifyOwner(api: RawApi, text: string): Promise<void> {
  for (const id of ownerIds().slice(0, 1)) await api.raw.sendMessage({ chat_id: Number(id), text }).catch(() => null);
}

/** A preview for the panel: what the next post for this project in this group would look like. Sends nothing. */
export async function preview(store: Store, chatId: string, projectId: number, compose: Compose | null = novaCompose): Promise<{ text: string; composer: string }> {
  const t = await store.target(chatId);
  const p = (await store.projects()).find((x) => x.id === projectId);
  if (!t || !p) throw new Error("unknown group or project");
  return composeFor(p, t, await store.logs(200, chatId), compose, Math.floor(Math.random() * 1000));
}

export const _resetPromo = (): void => { ready = false; };
