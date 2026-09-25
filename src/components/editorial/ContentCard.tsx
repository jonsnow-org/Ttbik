import Link from "next/link";

export default function ContentCard({
  href,
  title,
  blurb,
  dateLabel,
  meta,
  badge,
  badgeTone = "sky",
}: {
  href: string;
  title: string;
  blurb: string;
  dateLabel?: string;
  meta?: string;
  badge?: string;
  badgeTone?: "sky" | "indigo" | "emerald" | "rose";
}) {
  const tones: Record<string, string> = {
    sky: "bg-sky-50 text-sky-800 ring-sky-100",
    indigo: "bg-indigo-50 text-indigo-800 ring-indigo-100",
    emerald: "bg-emerald-50 text-emerald-800 ring-emerald-100",
    rose: "bg-rose-50 text-rose-800 ring-rose-100",
  };
  return (
    <li className="group relative list-none">
      <div className="overflow-hidden rounded-3xl border border-sky-100 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-sky-200 hover:shadow-md">
        <div className="h-1.5 bg-gradient-to-l from-sky-400 via-sky-500 to-indigo-500 opacity-80 transition group-hover:opacity-100" />
        <div className="p-4 sm:p-5">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] font-bold">
            {badge && (
              <span className={`rounded-full px-2.5 py-0.5 ring-1 ${tones[badgeTone]}`}>{badge}</span>
            )}
            {dateLabel && <span className="text-slate-500">{dateLabel}</span>}
            {meta && <span className="text-slate-400">· {meta}</span>}
          </div>
          <Link href={href} className="text-lg font-extrabold leading-8 text-slate-900 group-hover:text-sky-800">
            {title}
          </Link>
          <p className="mt-2 text-sm leading-7 text-slate-600">{blurb}</p>
          <div className="mt-4 flex items-center justify-between">
            <p className="text-xs font-bold text-sky-700 opacity-90 group-hover:opacity-100">اقرأ المزيد ←</p>
            <span className="rounded-full bg-sky-50 px-2.5 py-1 text-[10px] font-bold text-sky-700 ring-1 ring-sky-100 transition group-hover:bg-sky-500 group-hover:text-white group-hover:ring-sky-500">
              فتح
            </span>
          </div>
        </div>
      </div>
    </li>
  );
}
