import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit, verifyInitData } from "@/lib/match/inline";

/**
 * Photo upload from the jobs/store bot's own Mini App (product photos, dispute evidence). The chat keeps photos as Telegram file
 * ids, so the photo is sent once into the user's own chat with this bot (that is how Telegram hands out a file id), the id is kept,
 * and that helper message is deleted again. initData is checked with THIS bot's token; the same gates as the app apply.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;
const MAX_BYTES = 8 * 1024 * 1024;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const err = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

export async function POST(req: NextRequest, props: { params: Promise<{ botId: string }> }) {
  const { botId } = await props.params;
  const form = await req.formData().catch(() => null);
  const initData = form?.get("initData");
  const file = form?.get("file");
  if (!form || typeof initData !== "string" || !file || typeof file === "string") return err("طلب غير صالح");
  const botRow = await prisma.bot.findUnique({ where: { id: botId } }).catch(() => null);
  if (!botRow || !botRow.isActive || botRow.template !== "JOBS_BOT") return err("البوت غير متاح", 404);
  const tg = verifyInitData(initData, botRow.token);
  if (!tg) return err("افتح التطبيق من داخل تيليجرام", 401);
  if (!rateLimit(`japp-up:${botId}:${tg.id}`, 25, 600_000)) return err("طلبات كثيرة، تمهّل قليلاً", 429);
  const user = await prisma.jobsUser.findUnique({ where: { id: tg.id } });
  if (!user || user.isBanned || (user.mutedUntil && user.mutedUntil > new Date()) || !user.phoneVerified) return err("غير مسموح", 403);
  const blob = file as Blob;
  if (!TYPES.has(blob.type)) return err("أرسل صورة JPG أو PNG أو WEBP.");
  if (blob.size > MAX_BYTES) return err("الصورة أكبر من 8 ميغابايت.");
  const out = new FormData();
  out.set("chat_id", tg.id);
  out.set("disable_notification", "true");
  out.set("caption", "📷 صورة رُفعت من التطبيق");
  out.set("photo", blob, "photo.jpg");
  const r = await fetch(`https://api.telegram.org/bot${botRow.token}/sendPhoto`, { method: "POST", body: out, signal: AbortSignal.timeout(20000) }).then((x) => x.json()).catch(() => null);
  const sizes = r?.ok ? r.result?.photo : null;
  if (!Array.isArray(sizes) || !sizes.length) return err("تعذّر رفع الصورة. افتح محادثة البوت مرة ثم أعد المحاولة.", 502);
  const fileId = String(sizes[sizes.length - 1].file_id);
  await fetch(`https://api.telegram.org/bot${botRow.token}/deleteMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: tg.id, message_id: r.result.message_id }) }).catch(() => null);
  return NextResponse.json({ ok: true, fileId });
}
