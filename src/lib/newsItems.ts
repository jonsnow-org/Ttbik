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
    slug: "pichai-ai-compute-shortage-2027-ar",
    title: "سوندار بيتشاي يحذر: نقص طاقة الحوسبة للذكاء الاصطناعي قد يستمر حتى 2027",
    dateIso: "2026-10-24",
    dateLabel: "24 أكتوبر 2026",
    imageUrl: "https://images.unsplash.com/photo-1558494949-ef010cbdcc31?auto=format&fit=crop&w=1200&q=80",
    description: "الرئيس التنفيذي لغوغل يقول إن الطلب على الحوسبة يتجاوز العرض في صناعة الذكاء الاصطناعي، وقد يواجه العملاء صعوبة في الحصول على سعة لعام 2027. الشركة تعطي الأولوية لأبحاث النماذج المتقدمة حتى لو تأثرت إيرادات السحابة قصيرة الأجل.",
    paragraphs: [
      "ماذا حدث: في مقابلة حديثة مع بودكاست بيج تكنولوجي، قال سوندار بيتشاي إن صناعة الذكاء الاصطناعي تعاني من نقص في طاقة الحوسبة، وإن هذا النقص قد يستمر حتى عام 2027. أضاف أن «الجميع يعاني من النقص، وليس غوغل فقط، والجميع يتمنى لو كان لديه ضعف ما خطط له».",
      "لماذا يهم: الطلب على نماذج الذكاء الاصطناعي المتقدمة يرتفع بسرعة، بينما بناء مراكز البيانات والرقائق يستغرق وقتاً. بيتشاي أوضح أن السعة الحالية لدى غوغل تعكس قرارات استثمارية اتخذتها في 2024، وأن تأمين سعة لعملاء يطلبون 2027 «صعب للغاية». الشركة تضع أبحاث DeepMind والنماذج الحدية في المقدمة، حتى لو أدى ذلك إلى التخلي عن بعض إيرادات Google Cloud قصيرة الأجل.",
      "ماذا يعني ذلك: للمستخدمين والمطورين، قد تظهر حدود استخدام أو تأخير في بعض الخدمات المجانية أو المدفوعة التي تعتمد على نماذج كبيرة. للشركات، التخطيط طويل الأجل للحوسبة أصبح أكثر أهمية. هذا تقرير عن تصريحات عامة، وليس توقعاً أو نصيحة استثمارية.",
    ],
    sources: [
      { href: "https://www.cnbctv18.com/technology/googles-pichai-warns-ai-computing-shortages-could-persist-into-2027-20018128.htm", label: "CNBC TV18 — تقرير عن تصريحات بيتشاي" },
      { href: "https://www.bigtechnology.com/p/far-from-rsi-compute-shortages-google", label: "بيج تكنولوجي — مقابلة بيتشاي" },
    ],
  },
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
