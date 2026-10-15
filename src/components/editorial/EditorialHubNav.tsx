import Link from "next/link";
import { EDITORIAL_TABS, type EditorialTabId } from "@/config/navigation";

export type EditorialHubTab = EditorialTabId;

/** شريط أقسام مركز المدونة — يظهر في الأخبار والأحداث والمقالات */
export default function EditorialHubNav({ active }: { active: EditorialHubTab }) {
  return (
    <nav className="mb-6" aria-label="أقسام المدونة">
      <p className="mb-2 text-[11px] font-bold text-slate-500">مركز المدونة والأخبار</p>
      <div className="flex flex-wrap gap-2">
        {EDITORIAL_TABS.map((tab) => {
          const isActive = tab.id === active;
          return (
            <Link
              key={tab.id}
              href={tab.href}
              className={
                isActive
                  ? "rounded-full bg-sky-600 px-4 py-2 text-sm font-extrabold text-white shadow-sm transition-colors"
                  : "rounded-full bg-slate-100 px-4 py-2 text-sm font-bold text-slate-700 ring-1 ring-slate-200 transition-colors hover:bg-sky-50 hover:text-sky-800"
              }
              aria-current={isActive ? "page" : undefined}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
