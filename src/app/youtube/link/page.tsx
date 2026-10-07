import YoutubeLinkForm from "./Form";
import { readYoutubeState } from "@/lib/youtubeLink";

export default async function YoutubeLinkPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const { state } = await searchParams;
  const parsed = state ? readYoutubeState(state) : null;
  if (!parsed) return <main className="px-4 py-16 text-center">الرابط منتهي. افتح حساباتي من البوت من جديد.</main>;
  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <h1 className="text-2xl font-extrabold">ربط يوتيوب</h1>
      <p className="mt-2 text-sm text-slate-600">لا يحتاج مفاتيح. ضع الكود في وصف القناة، ثم الصق رابطها.</p>
      <div className="mt-4"><YoutubeLinkForm state={state || ""} code={parsed.code} /></div>
    </main>
  );
}
