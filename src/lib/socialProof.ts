import crypto from "crypto";
import { prisma } from "./prisma";

export const SOCIAL_PLATFORMS = ["youtube", "twitter", "tiktok", "facebook", "instagram", "link"] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

function salt() {
  return process.env.CRON_SECRET || "sham-social-public-link";
}
function sign(payload: string) {
  return crypto.createHmac("sha256", salt()).update(payload).digest("base64url");
}

export function proofCode(tgUserId: string, platform: string) {
  return `SHAM${platform.slice(0, 2).toUpperCase()}${tgUserId.slice(-4)}`;
}

export function socialStartUrl(site: string, tgUserId: string, platform: SocialPlatform) {
  const exp = Date.now() + 30 * 60 * 1000;
  const body = `${tgUserId}.${platform}.${exp}`;
  return `${site}/verify/link?state=${body}.${sign(body)}`;
}

export function readSocialState(state: string) {
  const parts = state.split(".");
  if (parts.length !== 4) return null;
  const [tgUserId, platform, exp, mac] = parts;
  if (sign(`${tgUserId}.${platform}.${exp}`) !== mac) return null;
  if (Number(exp) < Date.now()) return null;
  if (!SOCIAL_PLATFORMS.includes(platform as SocialPlatform)) return null;
  return { tgUserId, platform: platform as SocialPlatform, code: proofCode(tgUserId, platform) };
}

export async function pageHasCode(url: string, code: string) {
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(12000) }).catch(() => null);
  if (!res?.ok) return false;
  return (await res.text()).includes(code);
}

export async function saveSocialLink(tgUserId: string, platform: string, profileUrl: string) {
  await prisma.socialLink.upsert({
    where: { tgUserId_platform: { tgUserId, platform } },
    create: { tgUserId, platform, profileUrl },
    update: { profileUrl },
  });
}

export async function hasSocialLink(tgUserId: string, platform: string) {
  const row = await prisma.socialLink.findUnique({ where: { tgUserId_platform: { tgUserId, platform } } }).catch(() => null);
  return Boolean(row);
}

export async function verifySocialProof(tgUserId: string, platform: string) {
  const row = await prisma.socialLink.findUnique({ where: { tgUserId_platform: { tgUserId, platform } } }).catch(() => null);
  if (!row) return false;
  return pageHasCode(row.profileUrl, proofCode(tgUserId, platform));
}
