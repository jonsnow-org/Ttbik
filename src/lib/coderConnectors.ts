// Ready-made connectors for the coder (owner's request 2026-10-21: "like Grok Bot and Claude"): a list of services, each with a
// «توصيل» button that opens the service's own sign-in page (OAuth 2.0 authorization code), and the user comes back connected.
//   • per user: tokens are stored with saveConnection (AES-256-GCM, key CODER_TOKEN_KEY) under the salted chat hash; never shown again
//   • CSRF: `state` is HMAC-signed, bound to the Telegram user (verified from initData when the flow starts), the connector and a
//     15-minute expiry
//   • PKCE (S256) where the service supports it; the code_verifier is derived from the signed state with a server key, so nothing
//     has to be kept between the two legs and an attacker who sees the state still cannot compute it
//   • a service whose client id / secret env vars are not set shows as «قريباً» (soon), never as a broken button
//   • disconnect deletes the stored token and asks the service to revoke it where it offers that
// Callback: <site>/api/coder/app/connectors/<id>/callback (src/app/api/coder/app/connectors/[id]/callback/route.ts).
// An MCP server by URL is the "advanced" option: its URL (+ optional bearer token) is stored the same way under "mcp:<id>".
import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { coderChatKey, decryptToken, deleteConnection, encryptToken, prismaDb, saveConnection, type Db } from "@/lib/coderAuth";

export type ConnectorId = "github" | "google_drive" | "gmail" | "notion" | "vercel" | "supabase" | "slack" | "discord";
export type TokenSet = { access: string; refresh?: string; expiresAt?: number; extra?: Record<string, string> };
type F = typeof fetch;
export type ConnectorDef = {
  id: ConnectorId;
  name: string;
  desc: { ar: string; en: string };
  color: string;
  env: { id: string; secret: string };
  authUrl: string;
  tokenUrl: string;
  scope: string;
  scopeParam?: string;                       // Slack asks user scopes as "user_scope"
  pkce: boolean;
  clientAuth: "body" | "basic";
  bodyFormat: "form" | "json";
  extraAuth?: Record<string, string>;
  apiBases: string[];                        // where connector_api may call with this token
  apiHeaders?: Record<string, string>;
  createUrl: string;                         // where the owner creates the (free) OAuth app
  readToken?: (d: any) => TokenSet | null;   // non-standard token responses
  whoami: (t: TokenSet, f: F) => Promise<string>;
  revoke?: (t: TokenSet, f: F) => Promise<void>;
};

const T = (ms = 12000) => AbortSignal.timeout(ms);
const json = async (r: Response | null) => (r && r.ok ? r.json().catch(() => null) : null);
const bearer = (t: TokenSet, more: Record<string, string> = {}) => ({ Authorization: `Bearer ${t.access}`, Accept: "application/json", "User-Agent": "coder-bot", ...more });
const cid = (d: ConnectorDef) => (process.env[d.env.id] || "").trim();
const csec = (d: ConnectorDef) => (process.env[d.env.secret] || "").trim();
const basic = (d: ConnectorDef) => `Basic ${Buffer.from(`${cid(d)}:${csec(d)}`).toString("base64")}`;

const googleWho = async (t: TokenSet, f: F) => String((await json(await f("https://openidconnect.googleapis.com/v1/userinfo", { headers: bearer(t), signal: T() }).catch(() => null)))?.email || "");
const googleRevoke = async (t: TokenSet, f: F) => void (await f(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(t.refresh || t.access)}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: T() }).catch(() => null));

export const CONNECTORS: ConnectorDef[] = [
  {
    id: "github", name: "GitHub", color: "#181717",
    desc: { ar: "المستودعات والفروع وطلبات الدمج وCI", en: "Repos, branches, pull requests and CI" },
    env: { id: "CODER_GITHUB_CLIENT_ID", secret: "CODER_GITHUB_CLIENT_SECRET" },
    authUrl: "https://github.com/login/oauth/authorize", tokenUrl: "https://github.com/login/oauth/access_token",
    scope: "repo workflow admin:repo_hook read:user", pkce: true, clientAuth: "body", bodyFormat: "json", extraAuth: { allow_signup: "true" },
    apiBases: ["https://api.github.com/"], createUrl: "https://github.com/settings/applications/new",
    whoami: async (t, f) => String((await json(await f("https://api.github.com/user", { headers: bearer(t), signal: T() }).catch(() => null)))?.login || ""),
    revoke: async (t, f) => {
      const d = CONNECTORS[0];
      await f(`https://api.github.com/applications/${cid(d)}/grant`, { method: "DELETE", headers: { Authorization: basic(d), Accept: "application/vnd.github+json", "Content-Type": "application/json", "User-Agent": "coder-bot" }, body: JSON.stringify({ access_token: t.access }), signal: T() }).catch(() => null);
    },
  },
  {
    id: "google_drive", name: "Google Drive", color: "#1FA463",
    desc: { ar: "قراءة ملفاتك ومستنداتك في درايف", en: "Read your Drive files and docs" },
    env: { id: "CODER_GOOGLE_CLIENT_ID", secret: "CODER_GOOGLE_CLIENT_SECRET" },
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth", tokenUrl: "https://oauth2.googleapis.com/token",
    scope: "openid email https://www.googleapis.com/auth/drive.readonly", pkce: true, clientAuth: "body", bodyFormat: "form",
    extraAuth: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
    apiBases: ["https://www.googleapis.com/drive/", "https://docs.googleapis.com/", "https://sheets.googleapis.com/"],
    createUrl: "https://console.cloud.google.com/apis/credentials", whoami: googleWho, revoke: googleRevoke,
  },
  {
    id: "gmail", name: "Gmail", color: "#EA4335",
    desc: { ar: "قراءة بريدك والبحث فيه", en: "Read and search your mail" },
    env: { id: "CODER_GOOGLE_CLIENT_ID", secret: "CODER_GOOGLE_CLIENT_SECRET" },
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth", tokenUrl: "https://oauth2.googleapis.com/token",
    scope: "openid email https://www.googleapis.com/auth/gmail.readonly", pkce: true, clientAuth: "body", bodyFormat: "form",
    extraAuth: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
    apiBases: ["https://gmail.googleapis.com/"], createUrl: "https://console.cloud.google.com/apis/credentials", whoami: googleWho, revoke: googleRevoke,
  },
  {
    id: "notion", name: "Notion", color: "#000000",
    desc: { ar: "صفحاتك وقواعد بياناتك في نوشن", en: "Your Notion pages and databases" },
    env: { id: "CODER_NOTION_CLIENT_ID", secret: "CODER_NOTION_CLIENT_SECRET" },
    authUrl: "https://api.notion.com/v1/oauth/authorize", tokenUrl: "https://api.notion.com/v1/oauth/token",
    scope: "", pkce: false, clientAuth: "basic", bodyFormat: "json", extraAuth: { owner: "user" },
    apiBases: ["https://api.notion.com/v1/"], apiHeaders: { "Notion-Version": "2022-06-28" }, createUrl: "https://www.notion.so/profile/integrations",
    readToken: (d) => (d?.access_token ? { access: d.access_token, refresh: d.refresh_token, extra: { workspace: String(d.workspace_name || "") } } : null),
    whoami: async (t) => t.extra?.workspace || "",
  },
  {
    id: "vercel", name: "Vercel", color: "#000000",
    desc: { ar: "مشاريعك ونشراتك على فيرسل", en: "Your Vercel projects and deployments" },
    env: { id: "CODER_VERCEL_CLIENT_ID", secret: "CODER_VERCEL_CLIENT_SECRET" },
    authUrl: "https://vercel.com/oauth/authorize", tokenUrl: "https://api.vercel.com/login/oauth/token",
    scope: "openid email profile offline_access", pkce: true, clientAuth: "body", bodyFormat: "form",
    apiBases: ["https://api.vercel.com/"], createUrl: "https://vercel.com/docs/sign-in-with-vercel/manage-from-dashboard",
    whoami: async (t, f) => {
      const d = await json(await f("https://api.vercel.com/login/oauth/userinfo", { headers: bearer(t), signal: T() }).catch(() => null));
      return String(d?.preferred_username || d?.email || d?.name || "");
    },
    revoke: async (t, f) => {
      const d = CONNECTORS.find((x) => x.id === "vercel")!;
      await f("https://api.vercel.com/login/oauth/token/revoke", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: t.refresh || t.access, client_id: cid(d), client_secret: csec(d) }), signal: T() }).catch(() => null);
    },
  },
  {
    id: "supabase", name: "Supabase", color: "#3ECF8E",
    desc: { ar: "مشاريعك وقواعد بياناتك على سوبابيس", en: "Your Supabase projects and databases" },
    env: { id: "CODER_SUPABASE_CLIENT_ID", secret: "CODER_SUPABASE_CLIENT_SECRET" },
    authUrl: "https://api.supabase.com/v1/oauth/authorize", tokenUrl: "https://api.supabase.com/v1/oauth/token",
    scope: "", pkce: true, clientAuth: "basic", bodyFormat: "form",
    apiBases: ["https://api.supabase.com/v1/"], createUrl: "https://supabase.com/dashboard/org/_/apps",
    whoami: async (t, f) => {
      const d = await json(await f("https://api.supabase.com/v1/organizations", { headers: bearer(t), signal: T() }).catch(() => null));
      return Array.isArray(d) ? d.map((o: any) => String(o?.name || "")).filter(Boolean).slice(0, 3).join(", ") : "";
    },
  },
  {
    id: "slack", name: "Slack", color: "#4A154B",
    desc: { ar: "قنواتك ورسائلك في سلاك", en: "Your Slack channels and messages" },
    env: { id: "CODER_SLACK_CLIENT_ID", secret: "CODER_SLACK_CLIENT_SECRET" },
    authUrl: "https://slack.com/oauth/v2/authorize", tokenUrl: "https://slack.com/api/oauth.v2.access",
    scope: "channels:read channels:history groups:read users:read search:read", scopeParam: "user_scope", pkce: false, clientAuth: "body", bodyFormat: "form",
    apiBases: ["https://slack.com/api/"], createUrl: "https://api.slack.com/apps",
    readToken: (d) => {
      const u = d?.authed_user;
      const access = u?.access_token || d?.access_token;
      return d?.ok !== false && access ? { access, refresh: u?.refresh_token, expiresAt: u?.expires_in ? Date.now() + Number(u.expires_in) * 1000 : undefined, extra: { team: String(d?.team?.name || "") } } : null;
    },
    whoami: async (t) => t.extra?.team || "",
    revoke: async (t, f) => void (await f("https://slack.com/api/auth.revoke", { method: "POST", headers: { Authorization: `Bearer ${t.access}`, "Content-Type": "application/x-www-form-urlencoded" }, signal: T() }).catch(() => null)),
  },
  {
    id: "discord", name: "Discord", color: "#5865F2",
    desc: { ar: "حسابك وخوادمك في ديسكورد", en: "Your Discord account and servers" },
    env: { id: "CODER_DISCORD_CLIENT_ID", secret: "CODER_DISCORD_CLIENT_SECRET" },
    authUrl: "https://discord.com/oauth2/authorize", tokenUrl: "https://discord.com/api/oauth2/token",
    scope: "identify guilds", pkce: false, clientAuth: "body", bodyFormat: "form",
    apiBases: ["https://discord.com/api/"], createUrl: "https://discord.com/developers/applications",
    whoami: async (t, f) => String((await json(await f("https://discord.com/api/users/@me", { headers: bearer(t), signal: T() }).catch(() => null)))?.username || ""),
    revoke: async (t, f) => {
      const d = CONNECTORS.find((x) => x.id === "discord")!;
      await f("https://discord.com/api/oauth2/token/revoke", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: t.access, client_id: cid(d), client_secret: csec(d) }), signal: T() }).catch(() => null);
    },
  },
];
export const connectorById = (id: string) => CONNECTORS.find((c) => c.id === id) || null;
export const connectorReady = (d: ConnectorDef) => Boolean(cid(d) && csec(d));

/** The fixed, registered callback URL of a connector (the same value the owner pastes into the service's app settings). */
export function callbackUrl(id: string, base = siteBase()): string {
  return `${base}/api/coder/app/connectors/${id}/callback`;
}
export function siteBase(): string {
  return (process.env.CODER_OAUTH_BASE_URL || process.env.CODER_SELF_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/+$/, "");
}

// ---------------------------------------------------------------- state (CSRF) and PKCE
const key = () => process.env.CODER_TOKEN_KEY || process.env.CRON_SECRET || "";
const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export function signConnectorState(chatId: number, id: string, now = Date.now()): string {
  const body = `${chatId}.${id}.${now + 15 * 60000}.${randomBytes(8).toString("hex")}`;
  return `${body}.${createHmac("sha256", key()).update(`cstate|${body}`).digest("hex").slice(0, 40)}`;
}
export function verifyConnectorState(state: string, id: string, now = Date.now()): number | null {
  const p = String(state || "").split(".");
  if (p.length !== 5 || !key()) return null;
  const body = p.slice(0, 4).join(".");
  const want = Buffer.from(createHmac("sha256", key()).update(`cstate|${body}`).digest("hex").slice(0, 40));
  const got = Buffer.from(p[4]);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  if (p[1] !== id || Number(p[2]) < now || !/^\d+$/.test(p[0])) return null;
  return Number(p[0]);
}
export const pkceVerifier = (state: string) => b64url(createHmac("sha256", key()).update(`pkce|${state}`).digest()) + b64url(createHmac("sha256", key()).update(`pkce2|${state}`).digest()).slice(0, 20);
export const pkceChallenge = (verifier: string) => b64url(createHash("sha256").update(verifier).digest());

export function connectorStartUrl(chatId: number, id: string): string {
  const d = connectorById(id);
  if (!d || !connectorReady(d)) throw new Error("connector not available");
  const state = signConnectorState(chatId, id);
  const q = new URLSearchParams({ client_id: cid(d), redirect_uri: callbackUrl(id), response_type: "code", state, ...(d.extraAuth || {}) });
  if (d.scope) q.set(d.scopeParam || "scope", d.scope);
  if (d.pkce) {
    q.set("code_challenge", pkceChallenge(pkceVerifier(state)));
    q.set("code_challenge_method", "S256");
  }
  return `${d.authUrl}?${q}`;
}

// ---------------------------------------------------------------- token storage (one encrypted blob per user and service)
const provKey = (id: string) => `c:${id}`;           // GitHub keeps its historic "github" row (used by the coder's GitHub tools)
function packTokens(t: TokenSet): string {
  return JSON.stringify({ v: 1, ...t });
}
function unpackTokens(raw: string | null): TokenSet | null {
  if (!raw) return null;
  if (!raw.startsWith("{")) return { access: raw };
  try {
    const o = JSON.parse(raw);
    return o?.access ? { access: String(o.access), refresh: o.refresh || undefined, expiresAt: o.expiresAt || undefined, extra: o.extra || undefined } : null;
  } catch {
    return null;
  }
}

async function tokenRequest(d: ConnectorDef, params: Record<string, string>, f: F): Promise<any> {
  const body: Record<string, string> = { ...params };
  const headers: Record<string, string> = { Accept: "application/json" };
  if (d.clientAuth === "basic") headers.Authorization = basic(d);
  else Object.assign(body, { client_id: cid(d), client_secret: csec(d) });
  headers["Content-Type"] = d.bodyFormat === "json" ? "application/json" : "application/x-www-form-urlencoded";
  const r = await f(d.tokenUrl, { method: "POST", headers, body: d.bodyFormat === "json" ? JSON.stringify(body) : new URLSearchParams(body).toString(), signal: T(15000) });
  return r.json().catch(() => ({}));
}
const standard = (d: any): TokenSet | null => (d?.access_token ? { access: String(d.access_token), refresh: d.refresh_token ? String(d.refresh_token) : undefined, expiresAt: d.expires_in ? Date.now() + Number(d.expires_in) * 1000 : undefined } : null);

export class ConnectorError extends Error {}

/** The callback leg: verify state, exchange the code (with the PKCE verifier), store encrypted. Returns who connected. */
export async function finishConnector(id: string, code: string, state: string, db: Db = prismaDb, f: F = globalThis.fetch): Promise<{ chatId: number; label: string }> {
  const d = connectorById(id);
  if (!d || !connectorReady(d)) throw new ConnectorError("هذا الموصل غير متاح الآن.");
  const chatId = verifyConnectorState(state, id);
  if (!chatId) throw new ConnectorError("انتهت صلاحية رابط الربط أو أنه غير صالح. ابدأ من جديد من التطبيق.");
  if (!code) throw new ConnectorError("لم تكتمل الموافقة على الربط.");
  const params: Record<string, string> = { grant_type: "authorization_code", code, redirect_uri: callbackUrl(id) };
  if (d.pkce) params.code_verifier = pkceVerifier(state);
  const raw = await tokenRequest(d, params, f);
  const t = (d.readToken || standard)(raw);
  if (!t) throw new ConnectorError("لم يُرجع الموقع صلاحية الوصول. حاول مرة أخرى.");
  const label = (await d.whoami(t, f).catch(() => "")).slice(0, 120);
  if (id === "github") await saveConnection(chatId, "github", t.access, label, db);
  else await saveConnection(chatId, provKey(id) as any, packTokens(t), label, db);
  return { chatId, label };
}

async function rows(chatId: number | string, db: Db): Promise<{ provider: string; token_enc: string; login: string | null; updated_at?: string }[]> {
  try {
    await saveConnectionTable(db);
    return await db.query(`SELECT provider, token_enc, login, updated_at FROM coder_connections WHERE chat_key = $1`, coderChatKey(chatId));
  } catch {
    return [];
  }
}
let tableReady: Promise<void> | null = null;
function saveConnectionTable(db: Db): Promise<void> {
  if (db !== prismaDb) return Promise.resolve();
  if (!tableReady) {
    tableReady = db.exec(`CREATE TABLE IF NOT EXISTS coder_connections (chat_key TEXT NOT NULL, provider TEXT NOT NULL, token_enc TEXT NOT NULL, login TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (chat_key, provider))`).then(() => undefined).catch((e) => {
      tableReady = null;
      throw e;
    });
  }
  return tableReady;
}

/** A usable access token for a connected service (refreshed when it is about to expire), or null. */
export async function connectorToken(chatId: number | string, id: string, db: Db = prismaDb, f: F = globalThis.fetch): Promise<TokenSet | null> {
  const d = connectorById(id);
  if (!d) return null;
  const all = await rows(chatId, db);
  const row = all.find((r) => r.provider === (id === "github" ? "github" : provKey(id)));
  const t = unpackTokens(row ? decryptToken(row.token_enc) : null);
  if (!t) return null;
  if (t.expiresAt && t.expiresAt - Date.now() < 60000 && t.refresh && connectorReady(d)) {
    const raw = await tokenRequest(d, { grant_type: "refresh_token", refresh_token: t.refresh }, f).catch(() => null);
    const n = raw ? (d.readToken || standard)(raw) : null;
    if (n) {
      const next = { ...t, ...n, refresh: n.refresh || t.refresh };
      await saveConnection(chatId, provKey(id) as any, packTokens(next), row?.login || "", db);
      return next;
    }
  }
  return t;
}

export type ConnectorView = { id: string; name: string; desc: { ar: string; en: string }; color: string; status: "connected" | "available" | "soon"; label?: string; source?: "owner-env" | "user-link"; since?: string | null };
/** What the app may show: status and account label only, never a token. */
export async function listConnectors(chatId: number | string, opts: { githubOwnerEnv?: boolean } = {}, db: Db = prismaDb): Promise<ConnectorView[]> {
  const all = await rows(chatId, db);
  return CONNECTORS.map((d) => {
    const row = all.find((r) => r.provider === (d.id === "github" ? "github" : provKey(d.id)));
    if (d.id === "github" && opts.githubOwnerEnv) return { id: d.id, name: d.name, desc: d.desc, color: d.color, status: "connected", source: "owner-env", label: "" };
    if (row && decryptToken(row.token_enc)) return { id: d.id, name: d.name, desc: d.desc, color: d.color, status: "connected", label: row.login || "", source: "user-link", since: row.updated_at ? String(row.updated_at) : null };
    return { id: d.id, name: d.name, desc: d.desc, color: d.color, status: connectorReady(d) ? "available" : "soon" };
  });
}

/** Disconnect: ask the service to revoke (best effort), then delete the stored token. */
export async function disconnectConnector(chatId: number | string, id: string, db: Db = prismaDb, f: F = globalThis.fetch): Promise<void> {
  const d = connectorById(id);
  if (!d) throw new ConnectorError("unknown connector");
  const t = await connectorToken(chatId, id, db, f).catch(() => null);
  if (t && d.revoke && connectorReady(d)) await d.revoke(t, f).catch(() => null);
  await deleteConnection(chatId, (id === "github" ? "github" : provKey(id)) as any, db);
}

/** The ids the user has connected (for the model's system prompt). */
export async function connectedIds(chatId: number | string, db: Db = prismaDb): Promise<string[]> {
  const all = await rows(chatId, db);
  return CONNECTORS.filter((d) => d.id !== "github" && all.some((r) => r.provider === provKey(d.id))).map((d): string => d.id)
    .concat(all.filter((r) => r.provider.startsWith("mcp:")).map((r) => r.provider));
}

// ---------------------------------------------------------------- the coder's tool: read from a connected service
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
// POST endpoints that only read (searches / queries) — allowed without counting as a write
const READ_POSTS = [/^https:\/\/api\.notion\.com\/v1\/search$/, /^https:\/\/api\.notion\.com\/v1\/databases\/[\w-]+\/query$/];
export const isReadOnlyCall = (method: string, url: string) => !WRITE_METHODS.has(method) || READ_POSTS.some((rx) => rx.test(url));

export async function connectorApi(chatId: number | string, a: { service?: string; method?: string; path?: string; body?: unknown }, db: Db = prismaDb, f: F = globalThis.fetch): Promise<string> {
  const id = String(a.service || "");
  if (id.startsWith("mcp:")) return "error: use mcp_call for MCP servers";
  const d = connectorById(id);
  if (!d) return `error: unknown service "${id}". Connected: ${(await connectedIds(chatId, db)).join(", ") || "none"}`;
  const t = await connectorToken(chatId, id, db, f);
  if (!t) return `error: ${d.name} is not connected. Ask the user to connect it in the app (Connectors section).`;
  const method = String(a.method || "GET").toUpperCase();
  const raw = String(a.path || "");
  const url = raw.startsWith("https://") ? raw : `${d.apiBases[0].replace(/\/$/, "")}/${raw.replace(/^\//, "")}`;
  if (!d.apiBases.some((b) => url.startsWith(b))) return `error: ${d.name} calls must go to ${d.apiBases.join(" or ")}`;
  if (!["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(method)) return "error: bad method";
  const r = await f(url, {
    method,
    headers: { ...bearer(t, d.apiHeaders || {}), ...(a.body !== undefined && method !== "GET" ? { "Content-Type": "application/json" } : {}) },
    body: a.body !== undefined && method !== "GET" && method !== "HEAD" ? JSON.stringify(a.body) : undefined,
    signal: T(20000),
  }).catch((e) => ({ status: 0, text: async () => String(e?.message || e) }) as any);
  const text = await r.text().catch(() => "");
  return `HTTP ${r.status}\n${text.slice(0, 20000)}`;
}

// ---------------------------------------------------------------- MCP servers by URL (advanced)
export type McpServer = { id: string; url: string; label: string };
export async function addMcpServer(chatId: number | string, url: string, token: string, label: string, db: Db = prismaDb, check?: (u: string) => Promise<{ ok: boolean; why?: string }>): Promise<McpServer> {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    throw new ConnectorError("رابط غير صالح");
  }
  if (u.protocol !== "https:") throw new ConnectorError("يجب أن يبدأ الرابط بـ https://");
  if (check) {
    const c = await check(u.toString());
    if (!c.ok) throw new ConnectorError(c.why || "رابط غير مسموح");
  }
  const id = createHash("sha256").update(u.toString()).digest("hex").slice(0, 10);
  const name = (label || u.hostname).slice(0, 60);
  await saveConnection(chatId, `mcp:${id}` as any, JSON.stringify({ v: 1, access: token || "", url: u.toString() }), name, db);
  return { id: `mcp:${id}`, url: u.origin, label: name };
}
export async function listMcpServers(chatId: number | string, db: Db = prismaDb): Promise<McpServer[]> {
  return (await rows(chatId, db)).filter((r) => r.provider.startsWith("mcp:")).map((r) => {
    let url = "";
    try {
      url = new URL(JSON.parse(decryptToken(r.token_enc) || "{}").url).origin;
    } catch {
      /* unreadable row */
    }
    return { id: r.provider, url, label: r.login || url };
  });
}
export async function removeMcpServer(chatId: number | string, id: string, db: Db = prismaDb): Promise<void> {
  if (!/^mcp:[a-f0-9]{10}$/.test(id)) throw new ConnectorError("bad id");
  await deleteConnection(chatId, id as any, db);
}
async function mcpTarget(chatId: number | string, id: string, db: Db): Promise<{ url: string; token: string } | null> {
  const row = (await rows(chatId, db)).find((r) => r.provider === id);
  if (!row) return null;
  try {
    const o = JSON.parse(decryptToken(row.token_enc) || "{}");
    return o.url ? { url: String(o.url), token: String(o.access || "") } : null;
  } catch {
    return null;
  }
}
/** One JSON-RPC exchange with a Streamable-HTTP MCP server (initialize → method), JSON or SSE answers. */
export async function mcpRequest(chatId: number | string, id: string, method: "tools/list" | "tools/call", params: Record<string, unknown>, db: Db = prismaDb, f: F = globalThis.fetch): Promise<string> {
  const t = await mcpTarget(chatId, id, db);
  if (!t) return `error: MCP server ${id} is not connected`;
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(t.token ? { Authorization: `Bearer ${t.token}` } : {}) };
  const read = async (r: Response) => {
    const body = await r.text();
    if ((r.headers.get("content-type") || "").includes("text/event-stream")) {
      const data = body.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).filter(Boolean).pop() || "{}";
      return JSON.parse(data);
    }
    return JSON.parse(body || "{}");
  };
  try {
    const init = await f(t.url, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "coder-bot", version: "1.0" } } }), signal: T(15000) });
    const sid = init.headers.get("mcp-session-id");
    await read(init).catch(() => null);
    if (sid) headers["Mcp-Session-Id"] = sid;
    await f(t.url, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }), signal: T(8000) }).catch(() => null);
    const r = await f(t.url, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method, params }), signal: T(30000) });
    const d = await read(r);
    if (d?.error) return `error: ${JSON.stringify(d.error).slice(0, 2000)}`;
    return JSON.stringify(d?.result ?? d).slice(0, 20000);
  } catch (e) {
    return `error: MCP request failed: ${String((e as Error)?.message || e).slice(0, 300)}`;
  }
}

export { encryptToken };
