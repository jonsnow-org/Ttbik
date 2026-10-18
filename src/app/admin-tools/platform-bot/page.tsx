import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isOwnerServer } from "@/lib/isOwner";
import PlatformBotCreator from "./PlatformBotCreator";

export const metadata: Metadata = {
  title: "بوت Palmyra Launch | أدوات الأدمن",
  description: "تفعيل بوت المالك لمنصة العملات.",
  robots: { index: false, follow: false },
};

export default async function PlatformBotCreatorPage() {
  if (!await isOwnerServer()) redirect("/admin/login?next=/admin-tools/platform-bot");
  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <span className="inline-block rounded-full bg-amber-100 px-4 py-1.5 text-xs font-bold text-amber-800">🪙 قالب المنصة</span>
      <h1 className="mt-4 text-2xl font-extrabold text-slate-900 sm:text-3xl">بوت منصة العملات</h1>
      <p className="mt-2 text-slate-600">
        بوت مستقل للمالك: فتح وإغلاق المنصة، حالة ZNBt، والبلاغات. لا علاقة له ببوتي أثر وزنوبيا، وينتقل مع باقي البوتات عند نقل الاستضافة. Owner-only platform bot, independent of the Athar and Zenobia bots.
      </p>
      <PlatformBotCreator />
    </div>
  );
}
