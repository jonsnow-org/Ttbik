import Link from "next/link";

const LINKS = [
  ["/en", "Home"],
  ["/en/news", "News"],
  ["/en/articles", "Guides"],
  ["/en/events", "Dates"],
  ["/en/events/upcoming", "Upcoming"],
  ["/en/free-tools", "Tools"],
];

export default function EnglishDeskNav() {
  return (
    <nav className="sticky top-0 z-20 -mx-4 mb-6 flex gap-2 overflow-x-auto border-b border-sky-100 bg-white/95 px-4 py-3 backdrop-blur" aria-label="English sections">
      {LINKS.map(([href, label]) => (
        <Link key={href} href={href} className="rounded-full bg-sky-50 px-3 py-1.5 text-sm font-bold text-sky-900 ring-1 ring-sky-100 hover:bg-sky-500 hover:text-white">{label}</Link>
      ))}
    </nav>
  );
}
