import type { Metadata } from "next";
import Link from "next/link";
import TalkingPhoto from "@/app/free-tools/talking-photo/TalkingPhoto";
import AdSlot from "@/components/AdSlot";
import { SITE_URL } from "@/lib/siteUrl";

export const metadata: Metadata = {
  title: { absolute: "Talking Photo: Make Any Picture Speak, Free | Sham AI" },
  description: "Upload a picture and a voice (or record yours) and the picture speaks. Download a short video. Runs in your browser, nothing is uploaded.",
  alternates: {
    canonical: `${SITE_URL}/en/free-tools/talking-photo`,
    languages: { ar: `${SITE_URL}/free-tools/talking-photo`, en: `${SITE_URL}/en/free-tools/talking-photo`, "x-default": `${SITE_URL}/free-tools/talking-photo` },
  },
  openGraph: { locale: "en_US", url: `${SITE_URL}/en/free-tools/talking-photo`, title: "Talking Photo, free | Sham AI", description: "Picture + voice = a short video. In your browser, nothing uploaded." },
};

export default function TalkingPhotoEnPage() {
  return (
    <div dir="ltr" lang="en" className="mx-auto max-w-xl px-4 py-12">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-block rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">🎁 100% Free — Runs In Your Browser</span>
        <Link href="/free-tools/talking-photo" className="shrink-0 text-xs font-semibold text-slate-500 hover:text-brand-700">🇸🇦 Arabic version</Link>
      </div>
      <h1 className="mt-3 text-2xl font-extrabold text-slate-900">Make any picture speak</h1>
      <p className="mt-2 text-slate-600">Upload a portrait, a drawing or a fictional character, add an uploaded or recorded voice, and the picture moves with the sound. Download the video.</p>
      <div className="my-5"><AdSlot position="in-content" label="Above the talking photo tool" /></div>
      <TalkingPhoto lang="en" />
      <div className="mt-8"><AdSlot position="footer-banner" label="Below the talking photo tool" /></div>
      <section className="mt-10 rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm leading-7 text-slate-600">
        <h2 className="mb-2 text-base font-extrabold text-slate-900">Use it responsibly</h2>
        <p>Use pictures you own, fictional characters, or pictures of people who allowed it. Do not impersonate anyone or use the video to deceive or abuse. Every video carries an “AI-generated” mark.</p>
      </section>
    </div>
  );
}
