import { prisma } from "./prisma";
import { signLink, verifyLink } from "./linkSigning";

export const SOCIAL_PLATFORMS = ["youtube", "twitter", "tiktok", "facebook", "instagram", "link"] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];


export function proofCode(tgUserId: string, platform: string) {
  return `SHAM${platform.slice(0, 2).toUpperCase()}${tgUserId.slice(-4)}`;
}

export function socialStartUrl(site: string, tgUserId: string, platform: SocialPlatform) {
  const exp = Date.now() + 30 * 60 * 1000;
  const body = `${tgUserId}.${platform}.${exp}`;
  return `${site}/verify/link?state=${body}.${signLink("social", body)}`;
}

export function readSocialState(state: string) {
  const parts = state.split(".");
  if (parts.length !== 4) return null;
  const [tgUserId, platform, exp, mac] = parts;
  if (!verifyLink("social", `${tgUserId}.${platform}.${exp}`, mac)) return null;
  if (Number(exp) < Date.now()) return null;
  if (!SOCIAL_PLATFORMS.includes(platform as SocialPlatform)) return null;
  return { tgUserId, platform: platform as SocialPlatform, code: proofCode(tgUserId, platform) };
}

/**
 * The page a user claims as theirs must be a public https page. The server fetches it, so without this check anyone with a valid
 * link could make the server request internal addresses (localhost, cloud metadata, the Oracle box's private network).
 */
export function isPublicPageUrl(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== "https:" || u.username || u.password) return false;
  if (u.port && u.port !== "443") return false;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host || (!host.includes(".") && !host.includes(":"))) return false;
  if (/(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain)$/.test(host)) return false;
  if (host.includes(":")) return false; // IPv6 literals: real profile pages use names
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
  } else if (/^[\d.]+$/.test(host) || /^0x/i.test(host)) {
    return false; // shorthand / hex IPv4 forms
  }
  return true;
}

const MAX_PAGE_BYTES = 3 * 1024 * 1024;

export async function pageHasCode(url: string, code: string) {
  if (!isPublicPageUrl(url)) return false;
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(12000) }).catch(() => null);
  if (!res?.ok) return false;
  if (res.url && !isPublicPageUrl(res.url)) return false; // followed a redirect into a private address
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared > MAX_PAGE_BYTES) return false;
  const text = await res.text().catch(() => "");
  return text.slice(0, MAX_PAGE_BYTES).includes(code);
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
