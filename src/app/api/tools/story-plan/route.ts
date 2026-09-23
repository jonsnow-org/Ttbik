import { NextRequest, NextResponse } from "next/server";
import { callGroq } from "@/lib/groq";

// Server-side fallback for StoryVideoStudio's storyboard step, used when the
// visitor's browser can't reach the free Pollinations text API directly
// (it sometimes demands a Turnstile check from browsers). Tries Groq first
// (the site's own key), then Pollinations from the server.
const hits = new Map<string, { count: number; resetAt: number }>();
function rateLimited(ip: string) {
  const now = Date.now();
  const e = hits.get(ip);
  if (!e || now > e.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + 10 * 60 * 1000 });
    return false;
  }
  e.count += 1;
  return e.count > 20;
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  if (rateLimited(ip)) return NextResponse.json({ error: "rate" }, { status: 429 });
  const { system, description } = await req.json().catch(() => ({}));
  if (typeof system !== "string" || typeof description !== "string" || !description.trim()) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const sys = system.slice(0, 1500);
  const input = description.slice(0, 600);
  try {
    return NextResponse.json({ content: await callGroq(sys, input, 900) });
  } catch {
    /* fall through to Pollinations */
  }
  try {
    const res = await fetch("https://text.pollinations.ai/openai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai", referrer: "ttbik.vercel.app", messages: [{ role: "system", content: sys }, { role: "user", content: input }] }),
    });
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!res.ok || typeof content !== "string") throw new Error(String(res.status));
    return NextResponse.json({ content });
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 502 });
  }
}
