// Single list of /events articles, newest first — read by /events and by the
// homepage "today" strip (so the latest event is linked without duplicating
// titles). Add new articles at the top.
export type EventItem = {
  slug: string;
  title: string;
  dateLabel: string;
  blurb: string;
};

export const EVENT_ITEMS: EventItem[] = [
  {
    slug: "autumn-equinox-2026",
    title: "ما الذي نعرفه عن الاعتدال الخريفي 2026؟",
    dateLabel: "24 سبتمبر 2026",
    blurb: "الموعد الفلكي، لماذا لا يتساوى الليل والنهار دقيقة بدقيقة، ومتى ينتهي الفصل.",
  },
];
