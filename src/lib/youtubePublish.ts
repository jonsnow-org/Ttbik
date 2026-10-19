// Uploads the promo videos to the owner's YouTube channel with the YouTube Data API v3 (resumable upload, scope youtube.upload).
// Credentials: YOUTUBE_CLIENT_ID + YOUTUBE_CLIENT_SECRET (Google Cloud, set by the owner) and one refresh token, from YOUTUBE_REFRESH_TOKEN or
// from the one-time consent at /api/youtube/oauth (stored in the database). Nothing here is ever printed or returned.
import crypto from "crypto";
import { prisma } from "@/lib/prisma";

const KEY = "youtube_publish_refresh_token";
const SCOPE = "https://www.googleapis.com/auth/youtube.upload";
let ready: Promise<void> | null = null;
const ensure = () => (ready ??= prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS youtube_publish_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`).then(() => undefined).catch((e) => { ready = null; throw e; }));

const site = () => (process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/$/, "");
export const redirectUri = () => `${site()}/api/youtube/oauth`;
export const youtubeKeysPresent = () => Boolean(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET);

const sign = (s: string) => crypto.createHmac("sha256", process.env.CRON_SECRET || "").update(s).digest("base64url");
/** A signed, 15-minute state so only the owner (who holds the cron secret) can start the consent and only our own callback can finish it. */
export const makeState = () => { const t = String(Date.now() + 15 * 60 * 1000); return `${t}.${sign(t)}`; };
export const stateOk = (s: string) => { const [t, m] = s.split("."); return Boolean(process.env.CRON_SECRET && t && m && Number(t) > Date.now() && sign(t) === m); };

export function consentUrl(): string | null {
  if (!youtubeKeysPresent()) return null;
  const q = new URLSearchParams({ client_id: process.env.YOUTUBE_CLIENT_ID!, redirect_uri: redirectUri(), response_type: "code", scope: SCOPE, access_type: "offline", prompt: "consent", state: makeState() });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

export async function saveRefreshFromCode(code: string): Promise<boolean> {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: process.env.YOUTUBE_CLIENT_ID || "", client_secret: process.env.YOUTUBE_CLIENT_SECRET || "", redirect_uri: redirectUri(), grant_type: "authorization_code" }),
  }).catch(() => null);
  const j = r ? await r.json().catch(() => null) : null;
  if (!j?.refresh_token) return false;
  await ensure();
  await prisma.$executeRawUnsafe(`INSERT INTO youtube_publish_state (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`, KEY, String(j.refresh_token));
  return true;
}

async function refreshToken(): Promise<string | null> {
  if (process.env.YOUTUBE_REFRESH_TOKEN) return process.env.YOUTUBE_REFRESH_TOKEN;
  await ensure();
  return ((await prisma.$queryRawUnsafe(`SELECT value FROM youtube_publish_state WHERE key=$1`, KEY)) as { value: string }[])[0]?.value ?? null;
}

export async function youtubeReady(): Promise<boolean> { return youtubeKeysPresent() && Boolean(await refreshToken().catch(() => null)); }

async function accessToken(): Promise<string | null> {
  const rt = await refreshToken();
  if (!rt || !youtubeKeysPresent()) return null;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.YOUTUBE_CLIENT_ID!, client_secret: process.env.YOUTUBE_CLIENT_SECRET!, refresh_token: rt, grant_type: "refresh_token" }),
  }).catch(() => null);
  const j = r ? await r.json().catch(() => null) : null;
  return j?.access_token ? String(j.access_token) : null;
}

export type UploadResult = { ok: true; id: string } | { ok: false; reason: string };

/** Vertical clips under a minute become Shorts automatically; #Shorts in the title helps. privacy: public | unlisted | private. */
export async function uploadVideo(bytes: Uint8Array, o: { title: string; description: string; privacy?: "public" | "unlisted" | "private"; lang?: string }): Promise<UploadResult> {
  const token = await accessToken();
  if (!token) return { ok: false, reason: "youtube-not-authorised" };
  const meta = {
    snippet: { title: o.title.slice(0, 95), description: o.description.slice(0, 4900), categoryId: "28", defaultLanguage: o.lang || "en" },
    status: { privacyStatus: o.privacy || "public", selfDeclaredMadeForKids: false },
  };
  const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=UTF-8", "x-upload-content-type": "video/mp4", "x-upload-content-length": String(bytes.length) },
    body: JSON.stringify(meta),
  }).catch(() => null);
  const loc = init?.headers.get("location");
  if (!init?.ok || !loc) {
    const j = init ? await init.json().catch(() => null) : null;
    return { ok: false, reason: `youtube-init-${init?.status ?? "unreachable"}: ${String(j?.error?.message || "").slice(0, 120)}` };
  }
  const up = await fetch(loc, { method: "PUT", headers: { "content-type": "video/mp4", "content-length": String(bytes.length) }, body: bytes as unknown as BodyInit }).catch(() => null);
  const j = up ? await up.json().catch(() => null) : null;
  return j?.id ? { ok: true, id: String(j.id) } : { ok: false, reason: `youtube-upload-${up?.status ?? "unreachable"}: ${String(j?.error?.message || "").slice(0, 120)}` };
}
