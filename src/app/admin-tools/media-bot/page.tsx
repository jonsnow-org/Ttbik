import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isOwnerServer } from "@/lib/isOwner";
import MediaBotCreator from "./MediaBotCreator";

export const metadata: Metadata = {
  title: "منشئ بوت تحميل الوسائط | أدوات الأدمن",
  description: "إنشاء وإدارة بوت تحميل وسائط متقدم متعدد المنصات — مجاني دائماً.",
  robots: { index: false, follow: false },
};

export default function MediaBotCreatorPage() {
  const isOwner = isOwnerServer();
  if (!isOwner) {
    redirect("/admin/login?next=/admin-tools/media-bot");
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <span className="inline-block rounded-full bg-violet-50 px-4 py-1.5 text-xs font-bold text-violet-700">
        📥 بوت تحميل الوسائط المتقدم
      </span>
      <h1 className="mt-4 text-2xl font-extrabold text-slate-900 sm:text-3xl">
        منشئ بوت تحميل الوسائط
      </h1>
      <p className="mt-2 text-slate-600">
        منفصل تماماً عن منشئ البوتات العام. هذا القالب مصمم ليكون الأقوى مجاناً:
        كاش عبر قناة تيليجرام، تقطيع ذكي، استخراج صوت، واجهة عربية احترافية،
        وميزات قابلة للترقية لاحقاً.
      </p>

      <MediaBotCreator />
    </div>
  );
}
