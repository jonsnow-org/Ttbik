import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import AdSlot from "@/components/AdSlot";

type LinkItem = { label: string; url: string; order?: number };

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const card = await prisma.digitalCard.findUnique({
    where: { slug: params.slug },
    select: { title: true, bio: true },
  });
  if (!card) return { title: "بطاقة غير موجودة" };
  return {
    title: `${card.title} | شام AI`,
    description: card.bio || `بطاقة أعمال رقمية لـ ${card.title}`,
  };
}

export default async function DigitalCardPublicPage({
  params,
}: {
  params: { slug: string };
}) {
  const slug = (params.slug || "").trim().toLowerCase();
  if (!slug || slug.length > 32) notFound();

  const card = await prisma.digitalCard.findUnique({ where: { slug } });
  if (!card) notFound();

  // best-effort atomic view increment
  try {
    await prisma.digitalCard.update({
      where: { slug },
      data: { views: { increment: 1 } },
    });
  } catch {
    /* ignore */
  }

  const links = (Array.isArray(card.links) ? card.links : []) as LinkItem[];
  const sorted = [...links].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const theme = card.theme === "dark" ? "dark" : card.theme === "brand" ? "brand" : "simple";

  const bg =
    theme === "dark"
      ? "bg-slate-950 text-slate-100"
      : theme === "brand"
        ? "bg-gradient-to-b from-brand-50 to-white text-slate-900"
        : "bg-slate-50 text-slate-900";

  const cardBg =
    theme === "dark"
      ? "bg-slate-900 border-slate-700"
      : "bg-white border-slate-200";

  const btn =
    theme === "dark"
      ? "bg-slate-800 hover:bg-slate-700 border-slate-600 text-slate-100"
      : theme === "brand"
        ? "bg-brand-600 hover:bg-brand-700 border-brand-600 text-white"
        : "bg-slate-900 hover:bg-slate-800 border-slate-900 text-white";

  return (
    <div className={`min-h-[70vh] ${bg}`}>
      <div className="mx-auto max-w-md px-4 py-12">
        <div className={`rounded-3xl border ${cardBg} p-8 shadow-sm`}>
          {card.avatarUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={card.avatarUrl}
              alt=""
              className="mx-auto mb-4 h-24 w-24 rounded-full object-cover ring-2 ring-slate-200"
            />
          )}
          <h1 className="text-center text-2xl font-extrabold">{card.title}</h1>
          {card.bio && (
            <p className="mt-2 text-center text-sm opacity-80">{card.bio}</p>
          )}

          <div className="mt-8 grid gap-3">
            {sorted.map((l, i) => (
              <a
                key={i}
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`block rounded-2xl border px-4 py-3 text-center text-sm font-bold transition ${btn}`}
              >
                {l.label}
              </a>
            ))}
            {sorted.length === 0 && (
              <p className="text-center text-sm opacity-60">لا توجد روابط بعد</p>
            )}
          </div>

          <p className="mt-8 text-center text-[11px] opacity-50">
            مشاهدات: {card.views + 1}
          </p>
        </div>

        <p className="mt-6 text-center text-xs opacity-60">
          أنشئ بطاقتك المجانية على{" "}
          <Link href="/free-tools/digital-card" className="font-semibold underline">
            شام AI
          </Link>
        </p>

        <div className="mt-8">
          <AdSlot position="in-content" label="أسفل صفحة البطاقة العامة" />
        </div>
      </div>
    </div>
  );
}
