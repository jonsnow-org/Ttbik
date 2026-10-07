import BrandForm from "@/components/BrandForm";

export default function BrandPage() {
  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <h1 className="mb-2 text-2xl font-extrabold">أضف الأداة لموقعك</h1>
      <p className="mb-4 text-sm text-slate-600">دفعة واحدة 10$. بعد الموافقة تحصل على رابط بلونك واسمك، بلا جمع بيانات زوارك.</p>
      <BrandForm />
    </main>
  );
}
