import SponsorForm from "@/components/SponsorForm";

export default async function SponsorPage({ searchParams }: { searchParams: Promise<{ tool?: string }> }) {
  const { tool } = await searchParams;
  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <h1 className="mb-2 text-2xl font-extrabold">رعاية أداة</h1>
      <p className="mb-4 text-sm text-slate-600">سطر واحد أعلى الأداة. بلا جمع أرقام. بعد الدفع تُراجع الموافقة ثم يظهر السطر.</p>
      <SponsorForm initial={tool || ""} />
    </main>
  );
}
