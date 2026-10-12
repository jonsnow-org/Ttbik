import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isOwnerServer } from "@/lib/isOwner";
import ZenobiaBotCreator from "./ZenobiaBotCreator";

export const metadata: Metadata = {
  title: "منشئ بوت زنوبيا | أدوات الأدمن",
  description: "تفعيل بوت قافلة زنوبيا على تيليجرام.",
  robots: { index: false, follow: false },
};

export default async function ZenobiaBotCreatorPage() {
  if (!await isOwnerServer()) redirect("/admin/login?next=/admin-tools/zenobia-bot");
  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <span className="inline-block rounded-full bg-amber-100 px-4 py-1.5 text-xs font-bold text-amber-800">🏛 قالب زنوبيا</span>
      <h1 className="mt-4 text-2xl font-extrabold text-slate-900 sm:text-3xl">منشئ بوت زنوبيا</h1>
      <p className="mt-2 text-slate-600">
        بوت قافلة زنوبيا: تسجيل، حضور يومي، إحالات، لوحة صدارة، ومراحل رحلة زنوبيا — بالإنجليزية أولًا ومعها العربية. يعمل على webhook فيرسيل، وجدوله يُنشأ تلقائيًا عند أول استخدام.
      </p>
      <ZenobiaBotCreator />
    </div>
  );
}
