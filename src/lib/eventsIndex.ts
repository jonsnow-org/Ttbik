// Full events catalogue — newest first. Listing + [slug] both read from here.

export type EventSource = { href: string; label: string };
export type EventFaq = { q: string; a: string };

export type EventItem = {
  slug: string;
  title: string;
  dateIso: string;
  dateLabel: string;
  blurb: string;
  description: string;
  paragraphs: string[];
  faq: EventFaq[];
  sources: EventSource[];
  category?: string;
  imageUrl?: string;
};

export const EVENT_ITEMS: EventItem[] = [
  {
    slug: "world-space-week-2026",
    title: "الأسبوع العالمي للفضاء 2026: ماذا يحدث من 4 إلى 10 أكتوبر؟",
    dateIso: "2026-10-07",
    dateLabel: "7 أكتوبر 2026",
    category: "حدث اليوم",
    imageUrl:
      "https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?auto=format&fit=crop&w=1200&q=80",
    blurb:
      "يوم 7 أكتوبر يقع وسط الأسبوع العالمي للفضاء، مناسبة أممية من 4 إلى 10 أكتوبر تذكر بإطلاق سبوتنيك ومعاهدة الفضاء الخارجي.",
    description:
      "حدث 7 أكتوبر 2026: الأسبوع العالمي للفضاء، لماذا هذا التاريخ، وما علاقته بمهمة Crew-13 دون خلطه بخبر عاجل.",
    paragraphs: [
      "ماذا وقع: الأسبوع العالمي للفضاء مناسبة سنوية من 4 إلى 10 أكتوبر. يوم 7 أكتوبر 2026 يقع في وسطها. الجمعية العامة للأمم المتحدة اعتمدته عام 1999 للاحتفاء بمساهمة علوم الفضاء والتكنولوجيا في تحسين حياة الناس.",
      "متى ولماذا: الحدّان ليسا عشوائيين. 4 أكتوبر يذكر بإطلاق سبوتنيك-1 عام 1957، وـ 10 أكتوبر يذكر بدخول معاهدة الفضاء الخارجي حيز التنفيذ عام 1967. المناسبة تعريفية وليست عطلة.",
      "ما الذي تغير: في هذا الأسبوع نفسه تابعت وسائل إعلام إطلاق Crew-13 إلى محطة الفضاء الدولية. التفاصيل في خبر شام AI المنفصل: https://ttbik.vercel.app/news/spacex-crew-13-iss-2026 والمصدر الرسمي للأسبوع أدناه.",
      "فيديو رسمي للمناسبة متاح على يوتيوب عبر الرابط أدناه. إن لم يظهر المشغّل في الصفحة، افتح الرابط مباشرة.",
    ],
    faq: [
      { q: "متى الأسبوع العالمي للفضاء؟", a: "من 4 إلى 10 أكتوبر كل عام. يوم 7 أكتوبر 2026 داخل المناسبة." },
      { q: "لماذا هذان التاريخان؟", a: "4 أكتوبر لإطلاق سبوتنيك-1، وـ 10 أكتوبر لمعاهدة الفضاء الخارجي." },
      { q: "هل هو عطلة؟", a: "لا. هو أسبوع توعوي أممي." },
    ],
    sources: [
      { href: "https://www.worldspaceweek.org/", label: "World Space Week — الموقع الرسمي" },
      { href: "https://www.un.org/en/observances/world-space-week", label: "الأمم المتحدة — الأسبوع العالمي للفضاء" },
      { href: "https://www.youtube.com/watch?v=bNyUyrR0PHo", label: "فيديو — الجزيرة على يوتيوب" },
      { href: "https://ttbik.vercel.app/news/spacex-crew-13-iss-2026", label: "خبر شام AI — Crew-13" },
    ],
  },
  {
    slug: "international-day-of-non-violence-2026",
    title: "اليوم الدولي للاعنف 2026: لماذا يُحتفل في 2 أكتوبر؟",
    dateIso: "2026-10-02",
    dateLabel: "2 أكتوبر 2026",
    category: "مناسبة أممية",
    imageUrl:
      "https://images.unsplash.com/photo-1469571486292-0ba58a3f068b?auto=format&fit=crop&w=1200&q=80",
    blurb:
      "مناسبة أممية في 2 أكتوبر، يوم مولد المهاتما غاندي، تدعو إلى نشر ثقافة اللاعنف وفق قرار الجمعية العامة للأمم المتحدة.",
    description:
      "شرح موثّق لليوم الدولي للاعنف في 2 أكتوبر 2026.",
    paragraphs: [
      "يوافق اليوم الدولي للاعنف 2 أكتوبر من كل عام، وهو يوم مولد المهاتما غاندي. اعتمدت الجمعية العامة للأمم المتحدة هذه المناسبة في 15 يونيو 2007.",
      "المناسبة ليست عطلة رسمية في الدول العربية. هي يوم تذكير أممي بمبدأ رفض العنف وسيلة للتغيير.",
    ],
    faq: [
      { q: "متى اليوم الدولي للاعنف؟", a: "في 2 أكتوبر من كل عام." },
      { q: "هل هو عطلة رسمية؟", a: "لا. هو يوم أممي للتوعية." },
    ],
    sources: [
      { href: "https://www.un.org/en/observances/non-violence-day", label: "الأمم المتحدة — اليوم الدولي للاعنف" },
    ],
  },
];

export function getEvent(slug: string): EventItem | undefined {
  return EVENT_ITEMS.find((e) => e.slug === slug);
}

export function riyadhTodayIso(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function latestEvent(now = new Date()): EventItem | undefined {
  const iso = riyadhTodayIso(now);
  return (
    EVENT_ITEMS.find((e) => e.dateIso === iso) ||
    EVENT_ITEMS.find((e) => e.dateIso <= iso) ||
    EVENT_ITEMS[0]
  );
}

export function latestEvents(n = 6): EventItem[] {
  return EVENT_ITEMS.slice(0, n);
}
