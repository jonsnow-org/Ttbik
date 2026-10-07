import Link from "next/link";

const LINKS = [
  ["/en", "Home"],
  ["/en/news", "News"],
  ["/en/articles", "Articles"],
  ["/en/events", "Events"],
  ["/en/free-tools", "Tools"],
];

export default function EnglishDeskNav() {
  return (
    <nav className="sticky top-0 z-20 -mx-4 mb-8 flex gap-2 overflow-x-auto border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur" aria-label="English sections">
      {LINKS.map(([href, label]) => (
        <Link key={href} href={href} className="rounded-full border border-slate-200 px-3 py-1 text-sm font-semibold text-slate-700 hover:border-slate-900 hover:text-slate-900">{label}</Link>
      ))}
    </nav>
  );
}
