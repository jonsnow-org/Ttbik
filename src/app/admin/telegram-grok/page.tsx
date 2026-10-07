export default function TelegramMcpPage() {
  const site = (process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/$/, "");
  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <h1 className="text-2xl font-extrabold">ربط تلجرام لجروك</h1>
      <p className="mt-2 text-sm text-slate-600">هذه الصفحة داخل لوحة الأدمن. الزائر لا يراها، والنداء يُرفض بلا كلمة مرور الأدمن.</p>
      <p className="mt-4 rounded-xl bg-slate-100 px-3 py-2 text-sm" dir="ltr">{site}/api/mcp/telegram</p>
      <p className="mt-3 text-sm">لا تحتاج كلمة مرور. الصق الرابط فقط في الموصل المخصص.</p>
    </main>
  );
}
