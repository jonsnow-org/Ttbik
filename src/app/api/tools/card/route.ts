import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isRateLimited, requestIp } from "@/lib/rateLimit";
import { createHash, randomBytes } from "crypto";

const SLUG_RE = /^[a-z0-9][a-z0-9-_]{2,23}$/;
const CODE_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

function hashIp(ip: string): string {
  return createHash("sha256").update(ip + (process.env.RATE_LIMIT_SALT || "st")).digest("hex").slice(0, 16);
}

function generateSlug(): string {
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return out;
}

function isSafeUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (!u.hostname) return false;
    return true;
  } catch {
    return false;
  }
}

type LinkItem = { label: string; url: string; order?: number };

export async function POST(req: NextRequest) {
  const ip = requestIp(req);
  if (isRateLimited(`card:${ip}`, 5, 10 * 60 * 1000)) {
    return NextResponse.json(
      { error: "تجاوزت الحد المسموح (5 بطاقات / 10 دقائق). حاول لاحقاً." },
      { status: 429 }
    );
  }

  const exp = await req.json().catch(() => ({}));
  const title = typeof exp.title === "string" ? exp.title.trim().slice(0, 80) : "";
  const bio = typeof exp.bio === "string" ? exp.bio.trim().slice(0, 280) : null;
  const avatarUrlRaw = typeof exp.avatarUrl === "string" ? exp.avatarUrl.trim() : "";
  const theme =
    exp.theme === "dark" || exp.theme === "brand" ? exp.theme : "simple";
  let slug =
    typeof exp.slug === "string" ? exp.slug.trim().toLowerCase().replace(/\s+/g, "-") : "";

  if (!title) {
    return NextResponse.json({ error: "العنوان مطلوب" }, { status: 400 });
  }

  if (avatarUrlRaw && !isSafeUrl(avatarUrlRaw)) {
    return NextResponse.json(
      { error: "رابط الصورة غير صالح. استخدم http أو https فقط." },
      { status: 400 }
    );
  }

  const linksIn = Array.isArray(exp.links) ? exp.links : [];
  const links: LinkItem[] = [];
  for (let i = 0; i < Math.min(linksIn.length, 12); i++) {
    const item = linksIn[i];
    if (!item || typeof item !== "object") continue;
    const label = typeof item.label === "string" ? item.label.trim().slice(0, 40) : "";
    const url = typeof item.url === "string" ? item.url.trim() : "";
    if (!label || !url || !isSafeUrl(url)) continue;
    links.push({ label, url, order: i });
  }

  if (slug) {
    if (!SLUG_RE.test(slug)) {
      return NextResponse.json(
        {
          error:
            "المعرّف غير صالح. استخدم 3–24 حرفاً: أحرف إنجليزية صغيرة وأرقام و - و _ فقط.",
        },
        { status: 400 }
      );
    }
  } else {
    slug = generateSlug();
  }

  // ensure unique slug
  let attempts = 0;
  while (attempts < 8) {
    const existing = await prisma.digitalCard.findUnique({ where: { slug } });
    if (!existing) break;
    if (exp.slug) {
      return NextResponse.json(
        { error: "هذا المعرّف مستخدم بالفعل. اختر آخر." },
        { status: 409 }
      );
    }
    slug = generateSlug();
    attempts++;
  }

  // High-entropy bearer secret — never Math.random()
  const editToken = randomBytes(24).toString("hex");

  const site = process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik-gate.jonsnowx1r.workers.dev";

  try {
    const row = await prisma.digitalCard.create({
      data: {
        slug,
        title,
        bio,
        avatarUrl: avatarUrlRaw || null,
        links,
        theme,
        ownerIpHash: hashIp(ip),
        editToken,
      },
    });

    const publicUrl = `${site.replace(/\/$/, "")}/c/${row.slug}`;

    return NextResponse.json({
      slug: row.slug,
      publicUrl,
      editToken: row.editToken,
      views: 0,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "db error";
    return NextResponse.json({ error: "تعذر إنشاء البطاقة", detail: msg }, { status: 500 });
  }
}
