import { NextRequest, NextResponse } from "next/server";
import { pageHasCode, readSocialState, saveSocialLink } from "@/lib/socialProof";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = readSocialState(String(body.state || ""));
  const url = String(body.url || "");
  if (!parsed) return NextResponse.json({ error: "الرابط منتهي." }, { status: 400 });
  if (!/^https:\/\//.test(url)) return NextResponse.json({ error: "ضع رابط الصفحة." }, { status: 400 });
  if (!(await pageHasCode(url, parsed.code))) return NextResponse.json({ error: "الكود غير موجود في الصفحة. احفظها ثم أعد المحاولة." }, { status: 400 });
  await saveSocialLink(parsed.tgUserId, parsed.platform, url);
  return NextResponse.json({ ok: true });
}
