import BrandForm from "@/components/BrandForm";

import type { Metadata } from "next";

export const metadata: Metadata = { title: "هوية شام AI: الشعار والألوان وطلب الاستخدام", description: "الشعار الرسمي لشام AI وألوانه وقواعد استخدامه، ونموذج لطلب استخدام الهوية." };

export default function BrandPage() {
  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <h1 className="mb-2 text-2xl font-extrabold">أضف الأداة لموقعك</h1>
      <p className="mb-4 text-sm text-slate-600">دفعة واحدة 10$. بعد الموافقة تحصل على رابط بلونك واسمك، بلا جمع بيانات زوارك.</p>
      <BrandForm />
    </main>
  );
}
