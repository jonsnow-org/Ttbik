import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isOwnerServer } from "@/lib/isOwner";
import StarsQueue from "./StarsQueue";

export const metadata: Metadata = {
  title: "طابور نجوم أثر | أدوات الأدمن",
  description: "طلبات رموز أثر المدفوعة بنجوم تيليجرام: المطالبة بالتوقيع والاسترداد.",
  robots: { index: false, follow: false },
};

export default async function AtharStarsPage() {
  if (!await isOwnerServer()) redirect("/admin/login?next=/admin-tools/athar-stars");
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-2xl font-extrabold text-slate-900 sm:text-3xl">⭐ طابور نجوم أثر</h1>
      <p className="mt-2 text-slate-600">الأقدم أولاً. «تجهيز للسك» يحجز الطلب لك ويفتح لوحة أثر بالبيانات معبّأة؛ وقّع الرسالة هناك، وتتولى المهمة المجدولة إغلاق الطلب وإبلاغ المشتري.</p>
      <StarsQueue />
    </div>
  );
}
