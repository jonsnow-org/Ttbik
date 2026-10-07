import VerifyForm from "./Form";
import { readSocialState } from "@/lib/socialProof";

export default async function VerifyLinkPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const { state } = await searchParams;
  const parsed = state ? readSocialState(state) : null;
  if (!parsed) return <main className="px-4 py-16 text-center">الرابط منتهي. افتح حساباتي من البوت.</main>;
  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <h1 className="text-2xl font-extrabold">تحقق {parsed.platform}</h1>
      <p className="mt-2 text-sm text-slate-600">ضع الكود في الوصف العام ثم الصق رابط الصفحة. بلا مفاتيح.</p>
      <div className="mt-4"><VerifyForm state={state || ""} code={parsed.code} /></div>
    </main>
  );
}
