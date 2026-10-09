import Link from "next/link";

const COVERS: Record<string, string> = {
  "world-post-day-2026": "https://images.unsplash.com/photo-1526367790999-0150786686a2?auto=format&fit=crop&w=1200&q=80",
  "anne-carson-nobel-literature-2026": "https://images.unsplash.com/photo-1457369804613-52c61a468e7d?auto=format&fit=crop&w=1200&q=80",
  "browser-tools-keep-files-local": "https://images.unsplash.com/photo-1461749280684-dccba630e2f6?auto=format&fit=crop&w=1200&q=80",
  "qr-codes-for-menus-and-wifi": "https://images.unsplash.com/photo-1595079676339-1534801ad6cf?auto=format&fit=crop&w=1200&q=80",
  "how-to-check-a-public-date": "https://images.unsplash.com/photo-1506784983877-45594efa4cbe?auto=format&fit=crop&w=1200&q=80",
  "how-to-calculate-bmi": "https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?auto=format&fit=crop&w=1200&q=80",
  "how-to-add-or-remove-vat": "https://images.unsplash.com/photo-1554224155-6726b3ff858f?auto=format&fit=crop&w=1200&q=80",
  "whatsapp-click-to-chat": "https://images.unsplash.com/photo-1611746872915-64382b5c76da?auto=format&fit=crop&w=1200&q=80",
  "world-mental-health-day-2026": "https://images.unsplash.com/photo-1493836512294-502baa1986e2?auto=format&fit=crop&w=1200&q=80",
  "international-day-of-the-girl-2026": "https://images.unsplash.com/photo-1503454537195-1dcabb73ffb9?auto=format&fit=crop&w=1200&q=80",
  "disaster-risk-reduction-day-2026": "https://images.unsplash.com/photo-1464037866556-6812c9d1c72e?auto=format&fit=crop&w=1200&q=80",
  "world-standards-day-2026": "https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?auto=format&fit=crop&w=1200&q=80",
  "world-food-day-2026": "https://images.unsplash.com/photo-1464226184884-fa280b87c399?auto=format&fit=crop&w=1200&q=80",
  "public-domain-day-2027": "https://images.unsplash.com/photo-1481627834876-b7833e8f5570?auto=format&fit=crop&w=1200&q=80",
};

export function englishCover(slug: string) {
  return COVERS[slug] || "https://images.unsplash.com/photo-1495020689067-958852a7765e?auto=format&fit=crop&w=1200&q=80";
}

export default function EnglishStoryCard({
  href,
  slug,
  title,
  dek,
  date,
  badge,
}: {
  href: string;
  slug: string;
  title: string;
  dek: string;
  date: string;
  badge?: string;
}) {
  return (
    <Link href={href} className="block overflow-hidden rounded-3xl border border-sky-100 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-sky-300">
      <div className="relative aspect-[21/9] bg-sky-50">
        <img src={englishCover(slug)} alt="" className="h-full w-full object-cover" loading="lazy" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-white via-white/20 to-transparent" />
      </div>
      <div className="p-4">
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold">
          {badge && <span className="rounded-full bg-sky-50 px-2 py-0.5 text-sky-800 ring-1 ring-sky-100">{badge}</span>}
          <span className="text-slate-400">{date}</span>
        </div>
        <h2 className="mt-1 text-lg font-black text-slate-900">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-slate-600">{dek}</p>
      </div>
    </Link>
  );
}
