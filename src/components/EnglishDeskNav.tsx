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
    <nav className="mb-5 flex flex-wrap gap-3 text-sm text-slate-500" aria-label="English sections">
      {LINKS.map(([href, label]) => (
        <Link key={href} href={href} className="hover:text-slate-900">{label}</Link>
      ))}
    </nav>
  );
}
