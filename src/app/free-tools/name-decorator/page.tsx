import type { Metadata } from "next";
import { toolMeta } from "@/lib/toolMeta";
import NameDecorator from "./NameDecorator";
import AdSlot from "@/components/AdSlot";
import ToolSeoSection from "@/components/ToolSeoSection";

export const metadata: Metadata = toolMeta("name-decorator", {
  title: "زخرفة الأسماء بالعربي والإنجليزي للألعاب والسوشيال | شام AI",
  description:
    "زخرفة الأسماء العربية والإنجليزية بنسخ بضغطة واحدة لببجي وفري فاير وانستغرام وتيك توك وواتساب — مجاني وبلا تسجيل.",
  keywords: ["زخرفة الأسماء", "زخرفة اسم", "زخرفة أسماء ببجي", "زخرفة فري فاير", "زخرفة عربي", "اسماء مزخرفة"],
  alternates: { canonical: "/free-tools/name-decorator" },
});

export default function Page() {
  return (
    <>
      <div className="mx-auto max-w-xl px-4 py-12">
        <span className="inline-block rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">🎁 أداة مجانية بالكامل</span>
        <h1 className="mt-3 text-2xl font-extrabold text-slate-900">زخرفة الأسماء — عربي وإنجليزي للألعاب والسوشيال</h1>
        <p className="mt-2 text-slate-600">اكتب اسمك فتظهر عشرات الزخارف الجاهزة (تطويل، نجوم، تيجان، خطوط مزخرفة) انسخ منها ما يعجبك والصقه في ألعابك وحساباتك.</p>
        <div className="mt-6">
          <NameDecorator />
        </div>
        <div className="mt-8">
          <AdSlot position="in-content" label="أسفل زخرفة الأسماء للألعاب والسوشيال" />
        </div>
      </div>
      <ToolSeoSection slug="name-decorator" />
    </>
  );
}
