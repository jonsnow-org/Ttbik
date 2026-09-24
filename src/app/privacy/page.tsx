import AdSlot from "@/components/AdSlot";
export const metadata = { title: "سياسة الخصوصية | سوق تولز" };

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12 text-slate-700">
      <h1 className="mb-6 text-2xl font-extrabold text-slate-900">سياسة الخصوصية</h1>

      <div className="space-y-6 text-sm leading-7">
        <section>
          <h2 className="mb-2 font-bold text-slate-900">ما البيانات التي نجمعها</h2>
          <p>
            عند تقديم طلب، نجمع فقط: اسمك، وسيلة تواصل واحدة (تليجرام/واتساب/بريد إلكتروني)، وبيانات
            عملية التحويل (اسم المُحوِّل أو رقم العملية) للتحقق من الدفع. لا نطلب أي بيانات بطاقة
            بنكية أو كلمات مرور.
          </p>
        </section>

        <section>
          <h2 className="mb-2 font-bold text-slate-900">كيف تُستخدم بياناتك</h2>
          <p>
            تُستخدم فقط لمراجعة طلبك والتواصل معك بخصوصه وتسليم الخدمة المشتراة. لا نبيع أو نشارك
            بياناتك مع أي طرف ثالث.
          </p>
        </section>

        <section>
          <h2 className="mb-2 font-bold text-slate-900">تخزين البيانات</h2>
          <p>
            تُخزَّن بيانات الطلبات في قاعدة بيانات محمية (Supabase)، ولا يمكن الوصول إليها علناً عبر
            الإنترنت — فقط عبر لوحة التحكم الإدارية المحمية بكلمة مرور.
          </p>
        </section>

        <section>
          <h2 className="mb-2 font-bold text-slate-900">التجربة المجانية للأدوات</h2>
          <p>
            عند استخدام التجربة المجانية لأدوات الذكاء الاصطناعي، يُرسل النص الذي تكتبه إلى مزوّد
            خارجي (Groq) لمعالجته وإرجاع النتيجة فوراً؛ لا يُخزَّن هذا النص لدينا بعد إرجاع النتيجة.
          </p>
        </section>
      </div>
      <div className="mt-8">
        <AdSlot position="in-content" label="أسفل الخصوصية" />
      </div>
    </div>
  );
}
