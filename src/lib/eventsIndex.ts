// Single list of /events articles, newest first — read by /events and by the
// homepage "today" strip. Add new articles at the top.
export type EventItem = {
  slug: string;
  title: string;
  dateLabel: string;
  blurb: string;
  badge?: string;
};

export const EVENT_ITEMS: EventItem[] = [
  {
    slug: "world-environmental-health-day-2026",
    title: "اليوم العالمي للصحة البيئية 2026: لماذا يُحتفل في 26 سبتمبر؟",
    dateLabel: "26 سبتمبر 2026",
    blurb:
      "موعد سنوي للتوعية بربط البيئة بالصحة العامة — ماذا يعني للأفراد والمدن دون مبالغة أو أرقام غير موثقة.",
    badge: "حدث اليوم",
  },
  {
    slug: "autumn-equinox-2026",
    title: "ما الذي نعرفه عن الاعتدال الخريفي 2026؟",
    dateLabel: "24 سبتمبر 2026",
    blurb: "الموعد الفلكي، لماذا لا يتساوى الليل والنهار دقيقة بدقيقة، ومتى ينتهي الفصل.",
    badge: "فلكي",
  },
];
