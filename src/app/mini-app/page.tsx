import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "التطبيق المصغر | سوق تولز",
  description: "موجز الوسائط المشترك — الرئيسية والأحدث من التنزيلات المسموح بنشرها.",
};

export default function MiniAppPage() {
  return (
    <div className="mx-auto min-h-screen max-w-lg bg-slate-50 px-4 py-8">
      <header className="mb-6">
        <p className="text-xs font-bold text-violet-600">📱 التطبيق المصغر</p>
        <h1 className="mt-1 text-2xl font-extrabold text-slate-900">الرئيسية</h1>
        <p className="mt-1 text-sm text-slate-600">
          يظهر هنا فقط المحتوى الذي سمح أصحابه بعرضه من داخل إعدادات البوت.
        </p>
      </header>

      <nav className="mb-6 flex gap-2">
        <span className="rounded-full bg-violet-600 px-4 py-1.5 text-xs font-bold text-white">الأحدث</span>
        <span className="rounded-full bg-white px-4 py-1.5 text-xs font-bold text-slate-600 ring-1 ring-slate-200">
          فيديو
        </span>
        <span className="rounded-full bg-white px-4 py-1.5 text-xs font-bold text-slate-600 ring-1 ring-slate-200">
          صور
        </span>
        <span className="rounded-full bg-white px-4 py-1.5 text-xs font-bold text-slate-600 ring-1 ring-slate-200">
          صوت
        </span>
      </nav>

      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
        لا يوجد محتوى منشور بعد.\nفعّل «السماح بعرض تنزيلاتي» من إعدادات البوت ثم حمّل رابطاً.
      </div>
    </div>
  );
}
