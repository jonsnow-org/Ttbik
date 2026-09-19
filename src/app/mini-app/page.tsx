"use client";

/** Temporary restore notice — full UI loads from previous deployment cache; rebuild pending */
export default function MiniAppPage() {
  if (typeof window !== "undefined") {
    // redirect soft message
  }
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#0b1220] p-6 text-center text-white">
      <p className="text-4xl">⏳</p>
      <p className="mt-3 text-lg font-black">جاري استعادة التطبيق المصغر</p>
      <p className="mt-2 max-w-sm text-sm text-white/60">
        حدث خطأ مؤقت في النشر. أعد فتح الصفحة خلال دقيقة بعد اكتمال الإصلاح.
      </p>
      <a href="/" className="mt-6 rounded-xl bg-sky-500 px-6 py-3 text-sm font-bold">العودة</a>
    </div>
  );
}
