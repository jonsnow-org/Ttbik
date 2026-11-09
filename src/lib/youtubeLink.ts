import crypto from "crypto";
import { prisma } from "./prisma";
import { signLink, verifyLink } from "./linkSigning";

export function youtubeConfigured() {
  return true;
}

export function youtubeStartUrl(site: string, tgUserId: string) {
  const exp = Date.now() + 30 * 60 * 1000;
  const code = `SHAM${tgUserId.slice(-4)}${crypto.randomBytes(3).toString("hex").slice(0, 4).toUpperCase()}`;
  const body = `${tgUserId}.${exp}.${code}`;
  return `${site}/youtube/link?state=${body}.${signLink("youtube", body)}`;
}

export function readYoutubeState(state: string) {
  const parts = state.split(".");
  if (parts.length !== 4) return null;
  const [tgUserId, exp, code, mac] = parts;
  if (!verifyLink("youtube", `${tgUserId}.${exp}.${code}`, mac)) return null;
  if (Number(exp) < Date.now()) return null;
  if (!/^\d+$/.test(tgUserId)) return null;
  return { tgUserId, code };
}

export async function savePublicYoutube(tgUserId: string, channelId: string) {
  await prisma.youtubeLink.upsert({
    where: { tgUserId },
    create: { tgUserId, refreshToken: "public", channelId, googleSub: channelId },
    update: { refreshToken: "public", channelId, googleSub: channelId },
  });
}

export async function hasYoutubeLink(tgUserId: string) {
  const row = await prisma.youtubeLink.findUnique({ where: { tgUserId }, select: { tgUserId: true } });
  return Boolean(row);
}

export async function channelHasCode(channelUrl: string, code: string) {
  const res = await fetch(channelUrl, { headers: { "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(12000) });
  if (!res.ok) return null;
  const html = await res.text();
  if (!html.includes(code)) return null;
  const id = html.match(/"channelId":"(UC[\w-]{20,})"/) || html.match(/"externalId":"(UC[\w-]{20,})"/);
  return id?.[1] || channelUrl;
}

export async function verifyYoutubeSubscription(tgUserId: string, content: string) {
  const row = await prisma.youtubeLink.findUnique({ where: { tgUserId } });
  if (!row?.channelId) return false;
  const video = content.match(/[?&]v=([\w-]{6,})/) || content.match(/youtu\.be\/([\w-]{6,})/);
  if (!video) return Boolean(row.channelId);
  const res = await fetch(`https://www.youtube.com/watch?v=${video[1]}`, {
    headers: { "user-agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(12000),
  }).catch(() => null);
  if (!res?.ok) return false;
  const html = await res.text();
  return html.includes(row.channelId);
}
