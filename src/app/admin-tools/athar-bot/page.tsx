import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isOwnerServer } from "@/lib/isOwner";
import AtharBotCreator from "./AtharBotCreator";

export const metadata: Metadata = {
  title: "منشئ بوت أثر | أدوات الأدمن",
  description: "تفعيل قالب بوت أثر: يفتح تطبيق رموز التواريخ على TON.",
  robots: { index: false, follow: false },
};

export default function AtharBotCreatorPage() {
  if (!isOwnerServer()) redirect("/admin/login?next=/admin-tools/athar-bot");
  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <span className="inline-block rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-bold text-violet-300">🕰 قالب أثر</span>
      <h1 className="mt-4 text-2xl font-extrabold text-slate-900 sm:text-3xl">منشئ بوت أثر</h1>
      <p className="mt-2 text-slate-600">
        بوت تيليجرام يفتح التطبيق المصغر «أثر»: رمز لكل يوم في التقويم على شبكة TON. البوت خفيف،
        والتطبيق يعمل على Oracle، وكل شيء آخر يجري على السلسلة.
      </p>
      <AtharBotCreator />
    </div>
  );
}
