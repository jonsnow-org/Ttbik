import type { Metadata } from "next";
import StoryCardMaker from "./StoryCardMaker";
import { SITE_URL } from "@/lib/siteUrl";

export const metadata: Metadata = {
  title: "بطاقة ستوري للمشاركة | شام AI",
  description: "اصنع بطاقة ستوري بنتيجتك وشعار الموقع، مجاناً وداخل المتصفح.",
  alternates: { canonical: `${SITE_URL}/free-tools/story-card` },
};

export default function Page() {
  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <h1 className="text-2xl font-extrabold">بطاقة ستوري</h1>
      <p className="mt-2 text-sm text-slate-600">اكتب نتيجتك وتُرسم بطاقة 9:16 جاهزة لواتساب وستوري، وفي أسفلها رابط الموقع.</p>
      <div className="mt-4"><StoryCardMaker /></div>
    </main>
  );
}
