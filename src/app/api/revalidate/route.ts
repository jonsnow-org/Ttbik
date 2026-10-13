import { revalidatePath, revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

function unauthorized() {
  return NextResponse.json(
    { message: "غير مصرح: الرمز السري غير صحيح" },
    { status: 401 },
  );
}

function checkSecret(request: NextRequest): boolean {
  const { searchParams } = new URL(request.url);
  const secret =
    searchParams.get("secret") || request.headers.get("x-revalidate-secret");
  const expected = process.env.REVALIDATE_SECRET;
  if (!expected || !secret) return false;
  return secret === expected;
}

export async function POST(request: NextRequest) {
  try {
    if (!checkSecret(request)) return unauthorized();

    const { searchParams } = new URL(request.url);
    const body = await request.json().catch(() => ({} as Record<string, unknown>));

    let path =
      (searchParams.get("path") as string | null) ||
      (typeof body.path === "string" ? body.path : null);

    // حمولة Supabase Database Webhook: { table, record: { slug } }
    if (!path && body && typeof body === "object") {
      const record = (body as { record?: { slug?: string } }).record;
      const table = (body as { table?: string }).table || "articles";
      if (record?.slug) {
        path = `/${table}/${record.slug}`;
      }
    }

    const tag =
      (searchParams.get("tag") as string | null) ||
      (typeof body.tag === "string" ? body.tag : null);

    if (path) {
      revalidatePath(path);
      revalidatePath("/");
      if (path.startsWith("/articles")) revalidatePath("/articles");
      if (path.startsWith("/news")) revalidatePath("/news");
      if (path.startsWith("/events")) revalidatePath("/events");
      return NextResponse.json({
        revalidated: true,
        type: "path",
        target: path,
        timestamp: Date.now(),
      });
    }

    if (tag) {
      // Next.js 16: profile required (e.g. "max")
      revalidateTag(tag, "max");
      return NextResponse.json({
        revalidated: true,
        type: "tag",
        target: tag,
        timestamp: Date.now(),
      });
    }

    return NextResponse.json(
      { message: "يرجى توفير path أو tag في الطلب" },
      { status: 400 },
    );
  } catch (error) {
    return NextResponse.json(
      { message: "حدث خطأ أثناء كسر الكاش", error: String(error) },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  if (!checkSecret(request)) return unauthorized();

  const { searchParams } = new URL(request.url);
  const tag = searchParams.get("tag");
  if (tag) {
    // Next.js 16: profile required (e.g. "max") — same as POST
    revalidateTag(tag, "max");
    return NextResponse.json({
      revalidated: true,
      method: "GET",
      type: "tag",
      target: tag,
      timestamp: Date.now(),
    });
  }

  const path = searchParams.get("path") || "/";

  revalidatePath(path);
  revalidatePath("/");
  if (path.startsWith("/articles")) revalidatePath("/articles");
  if (path.startsWith("/news")) revalidatePath("/news");
  if (path.startsWith("/events")) revalidatePath("/events");

  return NextResponse.json({
    revalidated: true,
    method: "GET",
    type: "path",
    path,
    timestamp: Date.now(),
  });
}
