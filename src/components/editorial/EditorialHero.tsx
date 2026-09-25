import Link from "next/link";

type Crumb = { href?: string; label: string };

export default function EditorialHero({
  crumbs,
  title,
  subtitle,
  links,
}: {
  crumbs: Crumb[];
  title: string;
  subtitle: string;
  links?: { href: string; label: string }[];
}) {
  return (
    <header className="relative mb-8 overflow-hidden rounded-3xl border border-sky-100 bg-gradient-to-l from-sky-50 via-white to-indigo-50 px-5 py-6 sm:px-7 sm:py-8">
      <div className="pointer-events-none absolute -left-10 -top-10 h-40 w-40 rounded-full bg-sky-200/40 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute -bottom-12 -right-8 h-36 w-36 rounded-full bg-indigo-200/30 blur-3xl" aria-hidden />
      <nav className="relative mb-4 text-sm text-slate-500" aria-label="مسار التنقل">
        <ol className="flex flex-wrap items-center gap-1">
          {crumbs.map((c, i) => (
            <li key={c.label} className="flex items-center gap-1">
              {i > 0 && <span aria-hidden="true">/</span>}
              {c.href ? (
                <Link href={c.href} className="hover:text-slate-800">
                  {c.label}
                </Link>
              ) : (
                <span className="font-semibold text-slate-800">{c.label}</span>
              )}
            </li>
          ))}
        </ol>
      </nav>
      <h1 className="relative text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">{title}</h1>
      <p className="relative mt-3 max-w-xl text-sm leading-7 text-slate-600">{subtitle}</p>
      {links && links.length > 0 && (
        <div className="relative mt-4 flex flex-wrap gap-2">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-full bg-white/80 px-3 py-1.5 text-xs font-bold text-sky-800 ring-1 ring-sky-100 transition hover:bg-sky-50"
            >
              {l.label}
            </Link>
          ))}
        </div>
      )}
    </header>
  );
}
