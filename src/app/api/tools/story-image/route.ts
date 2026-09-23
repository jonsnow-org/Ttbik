import { NextRequest } from "next/server";

// Same-origin image proxy for StoryVideoStudio, used only when the browser
// can't load the free Pollinations image directly. Same-origin also keeps
// the canvas untainted (recordable) without relying on CORS headers.
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const prompt = (req.nextUrl.searchParams.get("prompt") || "").slice(0, 900);
  const seed = Number(req.nextUrl.searchParams.get("seed")) || 1;
  if (!prompt.trim()) return new Response("bad request", { status: 400 });
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=540&height=960&nologo=true&seed=${seed}&referrer=ttbik.vercel.app`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    const type = res.headers.get("content-type") || "";
    if (!res.ok || !type.startsWith("image/")) return new Response("upstream failed", { status: 502 });
    return new Response(res.body, {
      headers: { "Content-Type": type, "Cache-Control": "public, max-age=86400, immutable" },
    });
  } catch {
    return new Response("upstream failed", { status: 502 });
  }
}
