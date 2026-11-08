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
    slug: "openai-gpt-6-cyber-nov-2026",
    title: "أوبن إيه آي تطلق GPT-6 Cyber: نموذج أمن سيبراني محدود الوصول يجد ثغرات في لينكس وفايرفوكس",
    dateIso: "2026-11-05",
    dateLabel: "5 نوفمبر 2026",
    imageUrl: "https://images.unsplash.com/photo-1558494949-ef010cbdcc31?auto=format&fit=crop&w=1200&q=80",
    description: "أوبن إيه آي أطلقت GPT-6 Cyber لنموذج متخصص في البحث الأمني، متاح حالياً لمجموعة محدودة من عملاء Daybreak Red. النموذج ساعد في اكتشاف ثغرات في نواة لينكس وفايرفوكس.",
    paragraphs: [
      "ماذا حدث: في 5 نوفمبر 2026 أعلنت أوبن إيه آي عن GPT-6 Cyber، نسخة متخصصة من GPT-6 Astra مدربة على اكتشاف الثغرات وتطوير الاستغلالات ضمن نطاق مصرح به. النموذج متاح أولاً لمجموعة محدودة من العملاء المعتمدين في برنامج Daybreak Red عبر API وCodex.",
      "لماذا يهم: حسب الشركة، حقق النموذج 48.5% على مؤشر ExploitGym مقارنة بـ32.1% لسابقه، وساهم في إيجاد 81 ثغرة جديدة عالية الخطورة في فايرفوكس و948 استغلالاً لثغرات في نواة لينكس. التصنيف الأمني له Critical تحت إطار الاستعداد الخاص بالشركة.",
      "ماذا يعني ذلك: التوفر محدود حالياً لمنع سوء الاستخدام، والشركة تركز على البقاء ضمن النطاق المصرح. هذا تقرير عن الإعلان الرسمي من أوبن إيه آي وتغطية رويترز وذا فيرج، وليس تقييماً مستقلاً أو نصيحة أمنية.",
    ],
    sources: [
      { href: "https://openai.com/index/introducing-gpt-6-cyber/", label: "أوبن إيه آي — الإعلان الرسمي عن GPT-6 Cyber" },
      { href: "https://www.reuters.com/technology/openai-launches-gpt-6-cyber-with-critical-cybersecurity-rating-2026-11-05/", label: "رويترز — تغطية الإطلاق" },
      { href: "https://www.theverge.com/ai-artificial-intelligence/1027599/openai-gpt-6-cyber-launch", label: "ذا فيرج — تفاصيل النموذج والقيود" },
    ],
  },
  {
    slug: "us-midterms-2026-democrats-gains-nov",
    title: "انتخابات التجديد النصفي الأمريكية 2026: الديمقراطيون يحققون مكاسب تاريخية في مجلس النواب والشيوخ",
    dateIso: "2026-11-04",
    dateLabel: "4 نوفمبر 2026",
    imageUrl: "https://images.unsplash.com/photo-1540910419892-4a36d2c3266c?auto=format&fit=crop&w=1200&q=80",
    description: "أظهرت النتائج الأولية لانتخابات التجديد النصفي الأمريكية مكاسب ديمقراطية كبيرة، مستعيدة السيطرة على مجلس النواب ومحققة تقدماً في مجلس الشيوخ، في استفتاء واضح على سياسات الرئيس ترامب.",
    paragraphs: [
      "ماذا حدث: في 3-4 نوفمبر 2026 أظهرت النتائج أن الحزب الديمقراطي حقق مكاسب تاريخية في انتخابات التجديد النصفي، مستعيداً السيطرة على مجلس النواب (أكثر من 218 مقعداً) ومحققاً أغلبية في مجلس الشيوخ. التصويت جاء وسط مخاوف من تكلفة المعيشة والحرب في إيران وارتفاع أسعار الوقود.",
      "لماذا يهم: النتائج تعكس استياء الناخبين من أداء الإدارة الحالية. الرئيس ترامب أقر بدور الحرب مع إيران في الهزيمة الانتخابية. هذا يؤثر على التشريعات المستقبلية والسياسة الخارجية، خاصة المساعدات العسكرية والسياسات الاقتصادية.",
      "ماذا يعني ذلك: للأسواق العالمية والسياسة الدولية، قد يتغير ميزان القوى في الكونغرس مما يؤثر على الميزانية والسياسات. هذا تقرير عن النتائج الأولية الموثوقة من رويترز وغارديان وCNBC، وليس تحليلاً سياسياً أو توقع نهائي.",
    ],
    sources: [
      { href: "https://www.reuters.com/business/media-telecom/takeaways-us-midterm-elections-2026-11-04/", label: "رويترز — أهم الخلاصات من انتخابات التجديد النصفي" },
      { href: "https://www.theguardian.com/us-news/ng-interactive/2026/nov/04/midterm-elections-full-results-senate-house-governor-races", label: "الغارديان — نتائج مباشرة كاملة" },
      { href: "https://www.cnbc.com/2026/11/04/democrats-2026-midterm-election-results.html", label: "CNBC — الديمقراطيون يحققون اكتساحاً" },
    ],
  }
];

export function getNewsItem(slug: string): NewsItem | undefined {
  return NEWS_ITEMS.find((item) => item.slug === slug);
}

export function latestNewsItem(): NewsItem | undefined {
  return [...NEWS_ITEMS].sort((a, b) => b.dateIso.localeCompare(a.dateIso))[0];
}

export function newsSitemapEntries(): Array<{ path: string; dateIso: string; title: string }> {
  return NEWS_ITEMS.map((item) => ({
    path: `/news/${item.slug}`,
    dateIso: item.dateIso,
    title: item.title,
  }));
}
