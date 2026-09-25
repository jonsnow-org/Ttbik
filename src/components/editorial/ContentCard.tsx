import Link from "next/link";

export type ContentCardProps = {
  href: string;
  title: string;
  blurb: string;
  dateLabel?: string;
  badge?: string;
  meta?: string;
  variant?: "news" | "event" | "article";
};

const badgeTone: Record<string, string> = {
  news: "bg-rose-50 text-rose-700 ring-rose-100",
  event: "bg-indigo-50 text-indigo-700 ring-indigo-100",
  article: "bg-emerald-50 text-emerald-800 ring-emerald-100",
};

export default function ContentCard({
  href,
  title,
  blurb,
  dateLabel,
  badge,
  meta,
  variant = "article",
}: ContentCardProps) {
  const tone = badgeTone[variant] || badgeTone.article;
  return (
    <li className="group relative overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-md">
      <div
        className={`absolute inset-y-0 right-0 w-1 ${
          variant === "news"
            ? "bg-rose-400"
            : variant === "event"
              ? "bg-indigo-400"
              : "bg-emerald-400"
        }`}
        aria-hidden
      />
      <div className="p-4 pr-5 sm:p-5">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] font-bold">
          {badge && (
            <span className={`rounded-full px-2.5 py-0.5 ring-1 ring-inset ${tone}`}>{badge}</span>
          )}
          {dateLabel && <span className="text-slate-500">{dateLabel}</span>}
          {meta && <span className="text-slate-400">· {meta}</span>}
        </div>
        <Link href={href} className="text-lg font-extrabold leading-8 text-slate-900 group-hover:text-sky-800">
          {title}
        </Link>
        <p className="mt-2 text-sm leading-7 text-slate-600">{blurb}</p>
        <p className="mt-3 text-xs font-bold text-sky-700 opacity-80 group-hover:opacity-100">اقرأ المزيد ←</p>
      </div>
    </li>
  );
}
