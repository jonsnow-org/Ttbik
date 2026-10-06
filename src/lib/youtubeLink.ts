import crypto from "crypto";
import { prisma } from "./prisma";

const SCOPE = "https://www.googleapis.com/auth/youtube.readonly";

function secret() {
  return process.env.YOUTUBE_LINK_SECRET || process.env.CRON_SECRET || "";
}

export function youtubeConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && secret());
}

function sign(payload: string) {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function youtubeStartUrl(site: string, tgUserId: string) {
  if (!youtubeConfigured()) return null;
  const exp = Date.now() + 15 * 60 * 1000;
  const body = `${tgUserId}.${exp}`;
  const state = `${body}.${sign(body)}`;
  const redirect = `${site}/api/youtube/callback`;
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID || "");
  url.searchParams.set("redirect_uri", redirect);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

export function readYoutubeState(state: string) {
  const parts = state.split(".");
  if (parts.length !== 3) return null;
  const [tgUserId, exp, mac] = parts;
  if (sign(`${tgUserId}.${exp}`) !== mac) return null;
  if (Number(exp) < Date.now()) return null;
  if (!/^\d+$/.test(tgUserId)) return null;
  return tgUserId;
}

export async function exchangeYoutubeCode(site: string, code: string) {
  const body = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
    redirect_uri: `${site}/api/youtube/callback`,
    grant_type: "authorization_code",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) return null;
  return (await res.json()) as { access_token?: string; refresh_token?: string; id_token?: string };
}

export async function saveYoutubeLink(tgUserId: string, refreshToken: string, googleSub?: string) {
  await prisma.youtubeLink.upsert({
    where: { tgUserId },
    create: { tgUserId, refreshToken, googleSub: googleSub || null },
    update: { refreshToken, googleSub: googleSub || null },
  });
}

export async function hasYoutubeLink(tgUserId: string) {
  const row = await prisma.youtubeLink.findUnique({ where: { tgUserId }, select: { tgUserId: true } });
  return Boolean(row);
}

async function accessTokenFor(refreshToken: string) {
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { access_token?: string };
  return data.access_token || null;
}

async function channelIdFromContent(content: string, accessToken: string) {
  const channel = content.match(/youtube\.com\/channel\/(UC[\w-]+)/i);
  if (channel) return channel[1];
  const handle = content.match(/youtube\.com\/@([\w.-]+)/i);
  if (handle) {
    const url = new URL("https://www.googleapis.com/youtube/v3/channels");
    url.searchParams.set("part", "id");
    url.searchParams.set("forHandle", handle[1]);
    const res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return null;
    const data = (await res.json()) as { items?: { id: string }[] };
    return data.items?.[0]?.id || null;
  }
  const video = content.match(/[?&]v=([\w-]{6,})/) || content.match(/youtu\.be\/([\w-]{6,})/);
  if (!video) return null;
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("id", video[1]);
  const res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return null;
  const data = (await res.json()) as { items?: { snippet?: { channelId?: string } }[] };
  return data.items?.[0]?.snippet?.channelId || null;
}

export async function verifyYoutubeSubscription(tgUserId: string, content: string) {
  if (!youtubeConfigured()) return false;
  const row = await prisma.youtubeLink.findUnique({ where: { tgUserId } });
  if (!row?.refreshToken) return false;
  const access = await accessTokenFor(row.refreshToken);
  if (!access) return false;
  const channelId = await channelIdFromContent(content, access);
  if (!channelId) return false;
  const url = new URL("https://www.googleapis.com/youtube/v3/subscriptions");
  url.searchParams.set("part", "id");
  url.searchParams.set("mine", "true");
  url.searchParams.set("forChannelId", channelId);
  const res = await fetch(url, { headers: { authorization: `Bearer ${access}` } });
  if (!res.ok) return false;
  const data = (await res.json()) as { items?: unknown[] };
  return Array.isArray(data.items) && data.items.length > 0;
}
