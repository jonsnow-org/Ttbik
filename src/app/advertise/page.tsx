import type { Metadata } from "next";
import AdvertiseForm from "@/components/AdvertiseForm";
import { SITE_URL } from "@/lib/siteUrl";

export const metadata: Metadata = {
  title: "الإعلان على الموقع",
  description: "احجز بنر يظهر في كل صفحات شام AI لسبعة أو خمسة عشر أو ثلاثين يوماً بسعر ثابت، وادفع بالعملة الرقمية أو بنجوم تيليجرام.",
  alternates: { canonical: `${SITE_URL}/advertise`, languages: { ar: `${SITE_URL}/advertise`, en: `${SITE_URL}/en/advertise` } },
};

// 📦 Every paid promotion product in one place (2026-11-10); prices are the ones the order routes already charge.
const PACKAGES = [
  { icon: "🖼", title: "بنر في كل الصفحات", desc: "صورة أو فيديو قصير أو نص أعلى كل صفحات الموقع.", price: "7 أيام $15 · 15 يوماً $25 · 30 يوماً $40", href: "#order" },
  { icon: "🧰", title: "رعاية أداة مجانية", desc: "سطر «برعاية…» أعلى أداة يستخدمها الناس يومياً (الزكاة، QR، الضريبة، تحسين الصور…).", price: "من $15 لأسبوع", href: "/sponsor" },
  { icon: "🏷", title: "أداة باسم علامتك", desc: "نسخة من مولّد QR أو حاسبة الوزن بألوانك واسمك على رابط ثابت لسنة.", price: "$10 / سنة", href: "/brand" },
  { icon: "📢", title: "إعلان في قنوات تيليجرام بضمان", desc: "اختر قناة عربية بأرقام مشاهدة مفحوصة؛ المبلغ محفوظ لدى المنصة حتى يُنشر إعلانك ونتحقق منه. وافحص أي قناة مجاناً قبل الدفع.", price: "بسعر القناة · من $5 للمنشور", href: "/channels" },
  { icon: "🌙", title: "رعاية الختمات الجماعية", desc: "سطر «برعاية…» في كل رسالة ختم قرآن داخل مجموعات تيليجرام وعلى الصفحات التذكارية. راعٍ واحد في كل فترة.", price: "$30 لعشرة أيام", href: "/khatma#sponsor" },
  { icon: "📣", title: "حملة «شاهد واربح» على تيليجرام", desc: "قناتك أو رابطك يصل لمستخدمين حقيقيين يشاهدونه مقابل مكافأة؛ تدفع لكل مشاهدة من رصيدك في البوت.", price: "من $0.003 للمهمة · شحن الرصيد بالنجوم أو TON/USDT أو العملات الرقمية", href: "/watch-and-earn" },
];

export default function AdvertisePage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-extrabold">الإعلان على الموقع</h1>
      <p className="mt-2 text-sm leading-7 text-slate-600">مكان واحد في كل الصفحات. السعر ثابت: 7 أيام 15 دولاراً، 15 يوماً 25، 30 يوماً 40. بعد الدفع يصل الطلب إلى تلجرام للموافقة بنقرة، ثم يظهر البنر.</p>
      <section className="mt-6 grid gap-3 sm:grid-cols-2" aria-label="باقات الترويج">
        {PACKAGES.map((p) => (
          <a key={p.href} href={p.href} className="rounded-2xl border bg-white p-4 hover:border-amber-400">
            <p className="font-extrabold">{p.icon} {p.title}</p>
            <p className="mt-1 text-sm text-slate-600">{p.desc}</p>
            <p className="mt-2 text-sm font-bold text-amber-700">{p.price}</p>
          </a>
        ))}
      </section>
      <p className="mt-3 text-xs text-slate-500">طرق الدفع: 💎 عملات رقمية (NOWPayments: USDT وTON وBTC وغيرها)، ⭐ نجوم تيليجرام، أو تحويل USDT يدوي. يُحتسب الدفع تلقائياً فقط بعد تأكيد مزوّد الدفع، ويحصل كل معلن على رابط تقرير خاص بالمشاهدات والنقرات.</p>
      <div className="mt-6"><AdvertiseForm locale="ar" /></div>
    </main>
  );
}
