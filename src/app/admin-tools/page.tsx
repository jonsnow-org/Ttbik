import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isOwnerServer } from "@/lib/isOwner";
import Link from "next/link";

export const metadata: Metadata = {
  title: "أدوات الأدمن | شام AI",
  description: "أدوات وإدارة خاصة بمالك المنصة — منشئ بوتات الوسائط المتقدم وأكثر.",
  robots: { index: false, follow: false },
};

export default function AdminToolsPage() {
  const isOwner = isOwnerServer();
  if (!isOwner) {
    redirect("/admin/login?next=/admin-tools");
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <span className="inline-block rounded-full bg-violet-50 px-4 py-1.5 text-xs font-bold text-violet-700">
        🛠️ أدوات الأدمن — خاصة بالمالك
      </span>
      <h1 className="mt-4 text-3xl font-extrabold text-slate-900">أدوات الأدمن</h1>
      <p className="mt-2 text-slate-600">
        قسم منفصل تماماً عن منشئ البوتات العام. هنا تُنشأ وتُدار بوتات الوسائط المتقدمة
        والميزات التجريبية الخاصة بالمالك.
      </p>

      <div className="mt-10 grid gap-5 sm:grid-cols-2">
        <Link
          href="/admin-tools/media-bot"
          className="group relative overflow-hidden rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-md"
        >
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-l from-violet-500 to-fuchsia-500" />
          <span className="text-3xl">📥</span>
          <h2 className="mt-3 text-lg font-extrabold text-slate-900 group-hover:text-violet-700">
            منشئ بوت تحميل الوسائط
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            بوت قوي متعدد المنصات (يوتيوب، تيك توك، إنستغرام...) مع كاش قناة تيليجرام،
            تقطيع ذكي، وميزات متقدمة — مجاني دائماً.
          </p>
          <span className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-violet-600">
            فتح المنشئ ←
          </span>
        </Link>

        <Link
          href="/admin-tools/fadaa-bot"
          className="group relative overflow-hidden rounded-2xl border border-zinc-200 bg-gradient-to-br from-zinc-900 to-zinc-800 p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-md"
        >
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-l from-violet-500 to-fuchsia-400" />
          <span className="text-3xl">🌌</span>
          <h2 className="mt-3 text-lg font-extrabold text-white group-hover:text-violet-200">
            منشئ بوت فضاء
          </h2>
          <p className="mt-2 text-sm text-zinc-300">
            جلسات مؤقتة (معرفة · تجربة · قرار) مع تطبيق مصغر على Vercel — بدون Render.
          </p>
          <span className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-violet-300">
            فتح المنشئ ←
          </span>
        </Link>
        <Link
          href="/admin-tools/athar-bot"
          className="group relative overflow-hidden rounded-2xl border border-zinc-200 bg-gradient-to-br from-zinc-900 to-zinc-800 p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-md"
        >
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-l from-amber-400 to-yellow-300" />
          <span className="text-3xl">🕰</span>
          <h2 className="mt-3 text-lg font-extrabold text-white group-hover:text-amber-200">
            منشئ بوت أثر
          </h2>
          <p className="mt-2 text-sm text-zinc-300">
            رموز التواريخ على TON مع تطبيق مصغر يعمل على Oracle: بحث وشراء ومزادات وصناديق غموض.
          </p>
          <span className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-amber-300">
            فتح المنشئ ←
          </span>
        </Link>
      </div>

      <div className="mt-12 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
        <p className="font-bold">ملاحظة هندسية مهمة</p>
        <ul className="mt-2 list-inside list-disc space-y-1">
          <li>كل بوت وسائط يستخدم قناة تيليجرام خاصة كأرشيف دائم (file_id + رابط).</li>
          <li>الخدمة تعمل على Render Free مع كاش قوي لتقليل الاستهلاك.</li>
          <li>الميزات المدفوعة جاهزة كأعلام (Feature Flags) ويمكن تفعيلها لاحقاً بضغطة.</li>
        </ul>
      </div>
    </div>
  );
}
