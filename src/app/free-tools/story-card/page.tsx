import type { Metadata } from "next";
import { toolMeta } from "@/lib/toolMeta";
import StoryCardMaker from "./StoryCardMaker";
import { SITE_URL } from "@/lib/siteUrl";
import ToolSeoSection from "@/components/ToolSeoSection";
import AdSlot from "@/components/AdSlot";

export const metadata: Metadata = toolMeta("story-card", {
  title: "بطاقة ستوري للمشاركة | شام AI",
  description: "اصنع بطاقة ستوري بنتيجتك وشعار الموقع، مجاناً وداخل المتصفح.",
  alternates: { canonical: `${SITE_URL}/free-tools/story-card` },
});

function PageBody() {
  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <h1 className="text-2xl font-extrabold">بطاقة ستوري</h1>
      <p className="mt-2 text-sm text-slate-600">اكتب نتيجتك وتُرسم بطاقة 9:16 جاهزة لواتساب وستوري، وفي أسفلها رابط الموقع.</p>
      <div className="mt-4"><StoryCardMaker /></div>
      <div className="mt-8">
        <AdSlot position="in-content" label="أسفل بطاقة الستوري" />
      </div>
    </main>
  );
}

export default function Page() {
  return (
    <>
      <PageBody />
      <ToolSeoSection slug="story-card" />
    </>
  );
}
