import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isTikTok, mediaBotUsername, mediaDb } from "@/lib/mediaSocial";
import { mediaStreamUrl } from "@/lib/mediaStream";
import AdSlot from "@/components/AdSlot";

// Public share page for one media mini-app post: the "نسخ رابط خارجي"
// link. Its Open Graph tags give a real preview card (thumbnail + title)
// when the link is pasted into WhatsApp/Telegram/X/Facebook, and the page
// itself plays the video and offers the bot for getting a copy.

export const dynamic = "force-dynamic";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/$/, "");

async function loadPost(id: string) {
  const db = await mediaDb();
  if (!db) return null;
  const { data } = await db
    .from("media_feed")
    .select("id,media_type,title,url,thumbnail,sharer_name,views,likes,hidden,squad_code")
    .eq("id", id)
    .maybeSingle();
  const p = data as any;
  if (!p || p.hidden || p.squad_code) return null;
  const thumb = isTikTok(p.url) || !p.thumbnail ? `${SITE}/api/media-thumb?id=${p.id}` : String(p.thumbnail);
  const title = /^\d{6,}$/.test(String(p.title || "")) ? "مقطع مشارك" : String(p.title || "مقطع مشارك");
  return { ...p, thumb, title };
}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const p = await loadPost(params.id);
  if (!p) return { title: "المنشور غير متاح" };
  const isAudio = p.media_type === "audio" || p.media_type === "voice";
  const description = `شاركه ${p.sharer_name || "مستخدم"} — شاهده أو احصل على نسخة فورية عبر البوت.`;
  return {
    title: p.title,
    description,
    alternates: { canonical: `/m/${p.id}` },
    openGraph: {
      type: isAudio ? "music.song" : "video.other",
      title: p.title,
      description,
      url: `${SITE}/m/${p.id}`,
      images: [{ url: p.thumb }],
      ...(isAudio ? {} : { videos: [{ url: mediaStreamUrl(p.id), type: "video/mp4" }] }),
    },
    twitter: { card: "summary_large_image", title: p.title, description, images: [p.thumb] },
  };
}

export default async function SharedMediaPage({ params }: { params: { id: string } }) {
  const p = await loadPost(params.id);
  if (!p) notFound();
  const bot = await mediaBotUsername();
  const isAudio = p.media_type === "audio" || p.media_type === "voice";
  const stream = mediaStreamUrl(p.id);

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <div className="overflow-hidden rounded-3xl border border-sky-200 bg-white shadow-sm">
        {isAudio ? (
          <div className="flex flex-col items-center gap-4 bg-gradient-to-br from-indigo-100 to-sky-100 p-8">
            <span className="text-6xl">🎵</span>
            <audio src={stream} controls className="w-full" />
          </div>
        ) : (
          <video src={stream} poster={p.thumb} controls playsInline preload="metadata" className="max-h-[70vh] w-full bg-black" />
        )}
        <div className="p-5">
          <h1 className="text-lg font-extrabold text-slate-900">{p.title}</h1>
          <p className="mt-1 text-sm text-slate-500">
            شاركه {p.sharer_name || "مستخدم"} · 👁 {p.views || 0} · ❤ {p.likes || 0}
          </p>
          {bot && (
            <a
              href={`https://t.me/${bot}?start=clone_${p.id}`}
              className="mt-5 block rounded-2xl bg-gradient-to-l from-sky-500 to-indigo-500 py-3 text-center font-bold text-white shadow-md"
            >
              ⚡ احصل عليه فوراً في تيليجرام
            </a>
          )}
          {p.url && (
            <a href={p.url} target="_blank" rel="noreferrer nofollow" className="mt-3 block text-center text-sm font-semibold text-sky-700 underline">
              المصدر الأصلي
            </a>
          )}
        </div>
      </div>
      <div className="mt-4">
        <AdSlot position="in-content" label="أسفل مقطع مشارك" />
      </div>
    </div>
  );
}
