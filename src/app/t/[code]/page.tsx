import { prisma } from "@/lib/prisma";
import QrGenerator from "@/app/free-tools/qr-generator/QrGenerator";
import BmiCalculator from "@/app/free-tools/bmi-calculator/BmiCalculator";

export default async function BrandedTool({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const ad = await prisma.siteBannerAd.findUnique({ where: { reservationCode: code } }).catch(() => null);
  if (!ad || ad.kind !== "embed" || ad.paymentStatus !== "PAID" || ad.adStatus !== "ACTIVE") {
    return <main className="px-4 py-16 text-center">الرابط غير مفعّل بعد. أكمل الدفع ثم انتظر الموافقة.</main>;
  }
  return (
    <main className="min-h-screen" style={{ background: ad.bannerUrl }}>
      <div className="mx-auto max-w-xl px-4 py-8">
        <a href={ad.targetUrl} className="text-lg font-extrabold text-white">{ad.altText}</a>
        <div className="mt-4 rounded-2xl bg-white p-4">
          {ad.placement === "bmi-calculator" ? <BmiCalculator /> : <QrGenerator />}
        </div>
      </div>
    </main>
  );
}
