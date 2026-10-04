"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n";

const I = {
  home: <path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  find: <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>,
  box: <><path d="M3 7l9-4 9 4v10l-9 4-9-4z" /><path d="M3 7l9 4 9-4M12 11v10" /></>,
  gavel: <><path d="M14 4l6 6-3 3-6-6zM4 20l8-8M9 5l6 6" /></>,
  me: <><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4-6 8-6s7 2 8 6" /></>,
};
const TABS = [
  { href: "/", label: "nav.home", icon: I.home }, { href: "/date", label: "nav.find", icon: I.find },
  { href: "/mystery", label: "nav.mystery", icon: I.box }, { href: "/auctions", label: "nav.auctions", icon: I.gavel }, { href: "/mine", label: "nav.mine", icon: I.me },
] as const;
export default function Nav() {
  const path = usePathname();
  const { t } = useI18n();
  return (
    <nav className="nav">
      {TABS.map((tab) => (
        <Link key={tab.href} href={tab.href} className={(tab.href === "/" ? path === "/" : path.startsWith(tab.href)) ? "on" : ""}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{tab.icon}</svg>
          {t(tab.label)}
        </Link>
      ))}
    </nav>
  );
}
