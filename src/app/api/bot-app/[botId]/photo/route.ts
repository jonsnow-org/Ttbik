import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Product photos for the jobs/store bot's own Mini App. Listing photos are Telegram file ids (the chat stores them that way), so
 * the server fetches the file with the bot's token and streams the bytes; the token never reaches the browser. Only photos that
 * belong to a listing of this bot are served (a file id alone is not enough to read arbitrary files of the bot).
 */
export const dynamic = "force-dynamic";
const FILE_ID = /^[A-Za-z0-9_-]{20,200}$/;
const paths = new Map<string, { path: string; at: number }>();

export async function GET(req: NextRequest, props: { params: Promise<{ botId: string }> }) {
  const { botId } = await props.params;
  const f = req.nextUrl.searchParams.get("f") || "";
  if (!FILE_ID.test(f)) return new NextResponse(null, { status: 400 });
  const botRow = await prisma.bot.findUnique({ where: { id: botId }, select: { token: true, template: true, isActive: true } }).catch(() => null);
  if (!botRow || !botRow.isActive || botRow.template !== "JOBS_BOT") return new NextResponse(null, { status: 404 });
  const owned = await prisma.$queryRaw<{ x: number }[]>`SELECT 1 AS x FROM "StoreListing" WHERE "photoFileIds" @> ${JSON.stringify([f])}::jsonb LIMIT 1`.catch(() => []);
  if (!owned.length) return new NextResponse(null, { status: 404 });
  let p = paths.get(f);
  if (!p || Date.now() - p.at > 50 * 60_000) {
    const r = await fetch(`https://api.telegram.org/bot${botRow.token}/getFile?file_id=${encodeURIComponent(f)}`, { signal: AbortSignal.timeout(8000) }).then((x) => x.json()).catch(() => null);
    if (!r?.ok || !r.result?.file_path) return new NextResponse(null, { status: 404 });
    p = { path: String(r.result.file_path), at: Date.now() };
    paths.set(f, p);
    if (paths.size > 2000) paths.clear();
  }
  const file = await fetch(`https://api.telegram.org/file/bot${botRow.token}/${p.path}`, { signal: AbortSignal.timeout(15000) }).catch(() => null);
  if (!file?.ok || !file.body) return new NextResponse(null, { status: 502 });
  const type = /\.png$/i.test(p.path) ? "image/png" : /\.webp$/i.test(p.path) ? "image/webp" : "image/jpeg";
  return new NextResponse(file.body, { status: 200, headers: { "content-type": type, "cache-control": "public, max-age=86400, immutable", "x-content-type-options": "nosniff" } });
}
