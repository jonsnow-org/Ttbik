// Occasions: a small number stored in the token (0 = none). The picture changes with it; the meaning lives here.
import type { Lang } from "./i18n";

export const OCCASIONS: { id: number; names: Record<Lang, string>; gold?: boolean }[] = [
  { id: 1, names: { ar: "عيد ميلاد", en: "Birthday", ru: "День рождения", tr: "Doğum günü", fa: "تولد" } },
  { id: 2, names: { ar: "عيد زواج", en: "Wedding", ru: "Свадьба", tr: "Evlilik", fa: "ازدواج" }, gold: true },
  { id: 3, names: { ar: "مولود جديد", en: "Newborn", ru: "Новорождённый", tr: "Yeni bebek", fa: "نوزاد" } },
  { id: 4, names: { ar: "تخرّج", en: "Graduation", ru: "Выпуск", tr: "Mezuniyet", fa: "فارغ‌التحصیلی" } },
  { id: 5, names: { ar: "ذكرى", en: "Anniversary", ru: "Годовщина", tr: "Yıldönümü", fa: "سالگرد" }, gold: true },
  { id: 6, names: { ar: "تذكار", en: "Memorial", ru: "Память", tr: "Anma", fa: "یادبود" } },
  { id: 7, names: { ar: "إنجاز", en: "Achievement", ru: "Достижение", tr: "Başarı", fa: "دستاورد" } },
];
export const occasionById = (id: number) => OCCASIONS.find((o) => o.id === id) ?? null;

/** Emblems are drawn with code (no image files): centred on 0,0, about 100 units wide. */
export function emblem(id: number, color: string): string {
  const st = `fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"`;
  switch (id) {
    case 1: return `<g ${st}><rect x="-32" y="0" width="64" height="30" rx="6"/><path d="M-32 14h64M0 0v-22"/><path d="M0-28c-6 8 6 8 0 0z" fill="${color}"/></g>`;
    case 2: return `<g ${st}><circle cx="-14" cy="0" r="24"/><circle cx="14" cy="0" r="24"/></g>`;
    case 3: return `<g ${st}><ellipse cx="-16" cy="6" rx="10" ry="16"/><ellipse cx="16" cy="-6" rx="10" ry="16"/></g>`;
    case 4: return `<g ${st}><path d="M-44-8L0-30l44 22-44 22z"/><path d="M-24 4v20c14 10 34 10 48 0V4M44-8v26"/></g>`;
    case 5: return `<g ${st}><path d="M0 28C-40 2-40-30-16-30c10 0 16 6 16 14 0-8 6-14 16-14 24 0 24 28-16 58z" fill="${color}" fill-opacity="0.25"/></g>`;
    case 6: return `<g ${st}><rect x="-12" y="-4" width="24" height="42" rx="4"/><path d="M0-8c-8-10 8-14 0-26 12 8 14 18 0 26z" fill="${color}"/></g>`;
    case 7: return `<g ${st}><path d="M0-34l10 22 24 3-18 17 5 24-21-12-21 12 5-24-18-17 24-3z" fill="${color}" fill-opacity="0.25"/></g>`;
    default: return "";
  }
}
