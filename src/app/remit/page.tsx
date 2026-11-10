import type { Metadata } from "next";
import Link from "next/link";
import SwapWidget from "@/components/remit/SwapWidget";
import { botParam, PROVIDERS, providerLink } from "@/lib/remit/remit";
import { recordRemitOpen, savedRefLinks } from "@/lib/remit/refLinks";
import { activeListings } from "@/lib/remit/listings";
import { pickWidget } from "@/lib/remit/widgets";
import { SITE_URL } from "@/lib/siteUrl";

// The remittance section of the bots (the site bot and every ad bot made by the builder open this page as a Mini App, with ?bot=<id>).
// It exists to earn: the partner exchanger's widget, the owner's referral buttons, and paid company listings. Nothing else.
const PATH = "/remit";
export const dynamic = "force-dynamic"; // partner ids, referral links and paid listings change without a redeploy

export const metadata: Metadata = {
  title: "حوالات USDT: أرسل وبدّل العملات الرقمية",
  description: "بدّل إلى USDT (شبكة TRC20) وأرسله لمحفظة أي شخص خلال دقائق، مباشرة من محفظتك ودون حساب. لا نستلم أموالك ولا نحتفظ بها.",
  alternates: { canonical: `${SITE_URL}${PATH}` },
};

export default async function RemitPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  void recordRemitOpen(botParam(sp.bot)).catch(() => null);
  const [saved, listed] = await Promise.all([savedRefLinks().catch(() => ({} as Record<string, string>)), activeListings().catch(() => [])]);
  const widget = pickWidget(saved);
  const earning = PROVIDERS.map((p) => ({ ...p, ...providerLink(p, process.env, saved) })).filter((p) => p.sponsored && p.key !== widget?.provider);
  return (
    <main className="mx-auto max-w-xl px-3 py-5 text-slate-700" dir="rtl" lang="ar">
      <h1 className="text-xl font-extrabold text-slate-900">💸 حوالات USDT</h1>
      <p className="mt-1 text-sm leading-7">بدّل إلى <b>USDT (TRC20)</b> والصق عنوان محفظة المستلم (يبدأ بحرف T)، فيصله خلال دقائق، مباشرة من محفظتك ودون حساب.</p>
      {widget ? (
        <section className="mt-3" aria-label="تبديل وإرسال">
          <SwapWidget w={widget} />
        </section>
      ) : earning.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed p-4 text-center text-sm text-slate-500">⏳ خدمة التبديل تُفعَّل خلال وقت قصير. عُد لاحقاً.</p>
      ) : null}
      {earning.length > 0 && (
        <ul className="mt-4 space-y-2">
          {earning.map((p) => (
            <li key={p.key} className="flex items-center justify-between gap-3 rounded-xl border border-sky-200 bg-white p-3">
              <div><b className="text-slate-900">{p.name}</b><p className="text-xs text-slate-600">{p.note}</p></div>
              <a className="shrink-0 rounded-lg bg-sky-700 px-3 py-1.5 text-xs font-bold text-white" href={p.href} target="_blank" rel="sponsored noopener">ابدأ</a>
            </li>
          ))}
        </ul>
      )}
      {listed.length > 0 && (
        <section className="mt-6">
          <h2 className="text-base font-extrabold text-slate-900">📌 مكاتب وشركات تحويل</h2>
          <ul className="mt-2 space-y-2">
            {listed.map((l) => (
              <li key={l.code} className={`flex items-start justify-between gap-3 rounded-xl border p-3 ${l.plan === "FEATURED" ? "border-amber-300 bg-amber-50" : "bg-white"}`}>
                <div>
                  <b className="text-slate-900">{l.plan === "FEATURED" ? "⭐ " : ""}{l.name}</b>
                  <p className="text-xs text-slate-600">{l.country} · الترخيص: {l.license}{l.corridors ? ` · ${l.corridors}` : ""}</p>
                  <p className="text-[11px] text-slate-400">إعلان مدفوع</p>
                </div>
                <a className="shrink-0 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white" href={`/remit/go/${l.code}`} target="_blank" rel="sponsored noopener">تواصل</a>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="mt-5 text-[11px] leading-5 text-slate-400">
        لا نستلم أموالك ولا نحوّلها ولا نحتفظ بها: التبديل يتم لدى الخدمة مباشرة، وقد نحصل منها على عمولة دون تكلفة إضافية عليك. تأكد من العنوان والشبكة قبل الإرسال، فالتحويل الخاطئ لا يُسترد، وتحقّق من قوانين بلدك بشأن العملات الرقمية.
        {" "}<Link className="underline" href="/remit/join">مكتب تحويل؟ اظهر هنا</Link>
      </p>
    </main>
  );
}
