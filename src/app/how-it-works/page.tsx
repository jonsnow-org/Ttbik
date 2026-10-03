import type { Metadata } from "next";
import Link from "next/link";
import SectionBackdrop from "@/components/SectionBackdrop";
import AdSlot from "@/components/AdSlot";

export const metadata: Metadata = {
  title: "كيف يعمل الموقع؟ | شام AI",
  description: "شرح كامل لطريقة الطلب والدفع والحصول على أدواتك وبوتاتك خطوة بخطوة.",
};

const STEPS = [
  {
    title: "١. اختر خدمة أو أداة",
    body: "تصفّح الأقسام من الصفحة الرئيسية لخدمات وأدوات حقيقية، أو /free-tools للأدوات المجانية بلا طلب ولا دفع إطلاقاً. منشئ البوتات في /bots له مسار مختلف تماماً — انظر الأسئلة أسفل الصفحة.",
  },
  {
    title: "٢. أرسل الطلب",
    body: "في صفحة أي خدمة مدفوعة اضغط زر الطلب، واملأ بياناتك (الاسم ووسيلة التواصل). سيظهر لك فوراً رمز طلب فريد بصيغة ORD-XXXXXXXX — احفظه، فهو مفتاحك لتتبّع طلبك لاحقاً.",
  },
  {
    title: "٣. ادفع",
    body: "اختر إما ⚡ دفعاً فورياً تلقائياً بعملة رقمية (يُسلَّم لك فور تأكيد الدفع على الشبكة، دون انتظار)، أو تحويلاً بنكياً تقليدياً يحتاج موافقة يدوية بعد إدخال رقم/مرجع التحويل كإثبات دفع.",
  },
  {
    title: "٤. انتظر الموافقة (فقط في حال التحويل البنكي)",
    body: "يراجع مالك الموقع طلبك يدوياً (عادة خلال ساعات قليلة) بعد التأكد من التحويل. تابع حالة طلبك في أي وقت من صفحة «تتبع طلبي» بإدخال رمز الطلب.",
  },
  {
    title: "٥. استلم وصولك",
    body: "بمجرد الموافقة (فورية مع الدفع التلقائي، أو بعد المراجعة مع التحويل البنكي)، تظهر لك في نفس صفحة التتبع طريقة الاستلام حسب نوع الخدمة: رابط أداة تعمل داخل المتصفح بلا حدود، أو ملف/رابط تسليم.",
  },
];

const BOT_FAQ = [
  {
    q: "كيف أحصل على بوت إعلانات (AD_BOT) خاص بي؟",
    a: "ليس عبر متجر الخدمات — من داخل أي بوت إعلانات موجود فعلاً على المنصة: اضغط زر «أريد بوتاً مماثلاً»، حوّل 100$ عبر التحويل البنكي، وبعد موافقة يدوية من المالك تحصل على رمز تفعيل خاص بآيديك على تيليجرام تحديداً — تستخدمه في صفحة /bots مع توكن بوتك الخاص من BotFather.",
  },
  {
    q: "ماذا عن بوت التعارف والزواج الشرعي؟",
    a: "هذا القالب خاص بمالك المنصة فقط وغير متاح للبيع أو التفعيل لأي طرف آخر إطلاقاً — لا يوجد طلب أو تواصل يمكن أن يمنحك وصولاً إليه. كلمة السر الخاصة به مخصصة فقط لمالك المنصة نفسه، لإعادة تفعيل بوته الشخصي إن تعطّل.",
  },
  {
    q: "توكن BotFather من أين؟",
    a: "من تطبيق تليجرام، ابحث عن @BotFather، أرسل /newbot واتبع التعليمات، وسيعطيك سطراً بصيغة 123456789:AA...— هذا هو التوكن.",
  },
];

export default function HowItWorksPage() {
  return (
    <div className="relative mx-auto max-w-3xl px-4 py-12">
      <SectionBackdrop />
      <h1 className="text-2xl font-extrabold text-slate-900">كيف يعمل الموقع؟</h1>
      <p className="mt-2 text-slate-600">
        شرح مباشر لكل خطوة، من اختيار الخدمة حتى استلام وصولك الكامل — بلا غموض.
      </p>

      <div className="mt-8 space-y-6">
        {STEPS.map((s) => (
          <div key={s.title} className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="font-bold text-brand-700">{s.title}</h2>
            <p className="mt-1.5 text-sm text-slate-600">{s.body}</p>
          </div>
        ))}
      </div>

      <h2 className="mt-12 text-xl font-extrabold text-slate-900">أسئلة خاصة بمنشئ البوتات المستضافة</h2>
      <div className="mt-4 space-y-4">
        {BOT_FAQ.map((f) => (
          <div key={f.q} className="rounded-2xl border border-slate-200 bg-white p-5">
            <h3 className="font-bold text-slate-900">{f.q}</h3>
            <p className="mt-1.5 text-sm text-slate-600">{f.a}</p>
          </div>
        ))}
      </div>

      <div className="mt-10 flex flex-wrap gap-3">
        <Link href="/#categories" className="rounded-full bg-brand-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-800">
          تصفّح الخدمات
        </Link>
        <Link href="/order/lookup" className="rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50">
          تتبع طلبي
        </Link>
      </div>

      <div className="mt-8">
        <AdSlot position="in-content" label="أسفل كيف يعمل الموقع" />
      </div>
    </div>
  );
}
