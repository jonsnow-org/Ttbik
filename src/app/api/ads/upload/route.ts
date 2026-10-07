import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "لم تصل صورة أو فيديو." }, { status: 400 });
  const isVideo = file.type.startsWith("video/");
  const isImage = file.type.startsWith("image/");
  if (!isVideo && !isImage) return NextResponse.json({ error: "المسموح صورة أو فيديو فقط." }, { status: 400 });
  const max = isVideo ? 8 * 1024 * 1024 : 2 * 1024 * 1024;
  if (file.size > max) return NextResponse.json({ error: isVideo ? "الفيديو أطول من 8 ميغابايت." : "الصورة أكبر من 2 ميغابايت." }, { status: 400 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const ext = (file.name.split(".").pop() || (isVideo ? "mp4" : "jpg")).toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  try {
    const supabase = supabaseAdmin();
    const uploaded = await supabase.storage.from("ads").upload(path, bytes, { contentType: file.type, upsert: false });
    if (uploaded.error) return NextResponse.json({ error: "تعذر حفظ الملف. أنشئ حاوية ads عامة في Supabase." }, { status: 502 });
    const pub = supabase.storage.from("ads").getPublicUrl(path);
    return NextResponse.json({ url: pub.data.publicUrl, kind: isVideo ? "video" : "image" });
  } catch {
    return NextResponse.json({ error: "التخزين غير مفعّل. أنشئ حاوية ads في Supabase واجعلها عامة." }, { status: 502 });
  }
}
