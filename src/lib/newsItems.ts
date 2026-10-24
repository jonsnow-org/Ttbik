export type NewsSource = { href: string; label: string };

export type NewsItem = {
  slug: string;
  title: string;
  dateIso: string;
  dateLabel: string;
  description: string;
  paragraphs: string[];
  sources: NewsSource[];
  imageUrl?: string;
};

/** Authored news only. Newest first. Ticker RSS stays out. */
export const NEWS_ITEMS: NewsItem[] = [
  {
    slug: "php-critical-flaws-oct-2026-ar",
    title: "ثغرتان حرجتان في PHP تستدعيان تحديثات عاجلة للمواقع في أكتوبر 2026",
    dateIso: "2026-10-22",
    dateLabel: "22 أكتوبر 2026",
    imageUrl: "https://images.unsplash.com/photo-1555066931-4365d14bab8c?auto=format&fit=crop&w=1200&q=80",
    description: "ثغرتان حرجتان في PHP قد تسمحان بتنفيذ كود عن بُعد دون مصادقة. أصدرت PHP تحديثات أمنية، وتوصي الجهات المختصة بتحديث الأنظمة المتأثرة فوراً.",
    paragraphs: [
      "ماذا حدث: في أكتوبر 2026 كُشف عن ثغرتين حرجتين في PHP (CVE-2026-109618 وCVE-2026-109619) قد تتيحان لمهاجم تنفيذ كود على الخادم دون الحاجة إلى بيانات اعتماد. أصدر فريق PHP تحديثات أمنية لمعالجة المشكلتين.",
      "لماذا يهم: PHP يشغّل مواقع وتطبيقات ويب كثيرة. التأخر في التحديث قد يعرّض الخوادم والبيانات للخطر، وأفادت تقارير أمنية بوقوع محاولات استغلال وبتعطيل بعض المواقع مؤقتاً أثناء التصحيح.",
      "ماذا تفعل: إذا كنت تدير خادماً يستخدم PHP، فتحقق من الإصدارات المتأثرة وثبّت الإصدار المصحح المناسب من مزودك أو من PHP الرسمي. لا تعتمد على هذا الملخص وحده؛ راجع التنبيه الأمني الأصلي وتحقق من سجلاتك عند الاشتباه بوجود اختراق.",
    ],
    sources: [
      { href: "https://www.theguardian.com/technology/2026/oct/21/flaw-in-php-computer-language-leads-to-shutdown-of-websites-around-world", label: "الغارديان — تقرير عن أثر الثغرات" },
      { href: "https://www.enisa.europa.eu/news/joint-statement-on-critical-php-vulnerabilities", label: "وكالة الاتحاد الأوروبي للأمن السيبراني — التنبيه المشترك" },
      { href: "https://www.php.net/archive/2026.php#2026-10-20-1", label: "PHP — النشرة الأمنية الرسمية" },
    ],
  }
];

/** Find one authored item by its public slug. */
export function getNewsItem(slug: string): NewsItem | undefined {
  return NEWS_ITEMS.find((item) => item.slug === slug);
}

/** The newest authored news item, or undefined when the desk is empty. */
export function latestNewsItem(): NewsItem | undefined {
  return [...NEWS_ITEMS].sort((a, b) => b.dateIso.localeCompare(a.dateIso))[0];
}

/** Public URLs used by IndexNow and the news sitemap. */
export function newsSitemapEntries(): Array<{ path: string; dateIso: string; title: string }> {
  return NEWS_ITEMS.map((item) => ({
    path: `/news/${item.slug}`,
    dateIso: item.dateIso,
    title: item.title,
  }));
}
