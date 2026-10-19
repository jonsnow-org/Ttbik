import { NextRequest, NextResponse } from "next/server";
import { channelBotToken, isSafeForChannel } from "@/lib/channelPublisher";
import { posterToken } from "@/lib/coinsChannel";
import { uploadVideo, youtubeReady } from "@/lib/youtubePublish";

export const maxDuration = 60;

/**
 * Posts a rendered promo video (a pre-release asset of this repository, see .github/workflows/promo-remotion.yml) to a Telegram channel.
 * ?tag=promo-ep-N&asset=file.mp4&to=general|coins|youtube&caption=...&title=... ; to=youtube uploads to YouTube (Data API v3) instead of Telegram; the site fetches the public asset itself and sends it with the channel's own bot.
 */
const REPO = "jonsnow-org/Ttbik";
const CHANNELS = { youtube: () => "", general: () => process.env.TELEGRAM_CHANNEL_ID || "@ttbik5", coins: () => process.env.TELEGRAM_COINS_CHANNEL_ID || "@Zenobiaton" } as const;

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const q = req.nextUrl.searchParams;
  if (!process.env.CRON_SECRET || (auth !== `Bearer ${process.env.CRON_SECRET}` && q.get("secret") !== process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const tag = q.get("tag") || "", asset = q.get("asset") || "", to = (q.get("to") || "general") as keyof typeof CHANNELS;
  const caption = (q.get("caption") || "").slice(0, 1000);
  if (!/^promo-ep-\d{1,4}$/.test(tag) || !/^[\w.-]+\.mp4$/.test(asset) || !(to in CHANNELS)) return NextResponse.json({ ok: false, reason: "bad-request" }, { status: 400 });
  if (!caption || !isSafeForChannel(caption)) return NextResponse.json({ ok: false, reason: "caption-blocked" });
  const yt = to === "youtube";
  if (yt && !(await youtubeReady())) return NextResponse.json({ ok: false, reason: "youtube-not-set-up" });
  const token = yt ? "-" : to === "coins" ? (await posterToken()) || (await channelBotToken()) : await channelBotToken();
  if (!token) return NextResponse.json({ ok: false, reason: "no-bot-token" });

  const file = await fetch(`https://github.com/${REPO}/releases/download/${tag}/${asset}`).catch(() => null);
  if (!file?.ok) return NextResponse.json({ ok: false, reason: `asset-${file?.status ?? "unreachable"}` });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > 48 * 1024 * 1024) return NextResponse.json({ ok: false, reason: "too-large" });

  if (yt) {
    const title = (q.get("title") || "").slice(0, 80) || "Palmyra Launch";
    const r = await uploadVideo(bytes, { title: `${title} #Shorts`, description: `${caption}\n\n#Shorts`, privacy: process.env.YOUTUBE_PRIVACY === "unlisted" ? "unlisted" : "public", lang: q.get("lang") || "en" });
    return NextResponse.json(r.ok ? { ok: true, to, id: r.id } : r);
  }
  const form = new FormData();
  form.append("chat_id", CHANNELS[to]());
  form.append("caption", caption);
  form.append("supports_streaming", "true");
  form.append("width", "1080");
  form.append("height", "1920");
  form.append("video", new Blob([bytes], { type: "video/mp4" }), asset);
  const res = await fetch(`https://api.telegram.org/bot${token}/sendVideo`, { method: "POST", body: form }).catch(() => null);
  const data = res ? await res.json().catch(() => null) : null;
  return NextResponse.json(data?.ok === true ? { ok: true, to } : { ok: false, reason: `telegram: ${String(data?.description || "request-failed").slice(0, 160)}` });
}
