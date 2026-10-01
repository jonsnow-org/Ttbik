import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isOwnerServer } from "@/lib/isOwner";
import FadaaBotCreator from "./FadaaBotCreator";

export const metadata: Metadata = {
  title: "منشئ بوت فضاء | أدوات الأدمن",
  description: "تفعيل قالب بوت فضاء مع التطبيق المصغر — جلسات مؤقتة على Vercel.",
  robots: { index: false, follow: false },
};

export default function FadaaBotCreatorPage() {
  if (!isOwnerServer()) redirect("/admin/login?next=/admin-tools/fadaa-bot");
  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <span className="inline-block rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-bold text-violet-300">🌌 قالب فضاء</span>
      <h1 className="mt-4 text-2xl font-extrabold text-slate-900 sm:text-3xl">منشئ بوت فضاء</h1>
      <p className="mt-2 text-slate-600">
        بوت تيليجرام يفتح التطبيق المصغر «فضاء» (جلسات معرفة · تجربة · قرار). يعمل على Vercel
        بالكامل — بدون Render — والتخزين عبر Supabase عند تفعيل الجداول.
      </p>
      <FadaaBotCreator />
    </div>
  );
}
