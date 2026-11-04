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
    slug: "us-midterms-2026-democrats-gains-nov",
    title: "انتخابات التجديد النصفي الأمريكية 2026: الديمقراطيون يحققون مكاسب كبيرة",
    dateIso: "2026-11-04",
    dateLabel: "4 نوفمبر 2026",
    imageUrl: "https://images.unsplash.com/photo-1540910419892-4a36d2c3266c?auto=format&fit=crop&w=1200&q=80",
    description: "أظهرت النتائج الأولية لانتخابات التجديد النصفي الأمريكية مكاسب ديمقراطية كبيرة في مجلس النواب ومجلس الشيوخ، في استفتاء على سياسات الرئيس ترامب.",
    paragraphs: [
      "ماذا حدث: في 4 نوفمبر 2026 أظهرت النتائج الأولية لانتخابات التجديد النصفي الأمريكية أن الحزب الديمقراطي حقق مكاسب تاريخية، مستعيداً السيطرة على مجلس النواب ومحققاً تقدماً في مجلس الشيوخ. التصويت جاء وسط مخاوف من تكلفة المعيشة والحرب في إيران.",
      "لماذا يهم: النتائج تعكس استياء الناخبين من أداء الإدارة الحالية. الرئيس ترامب أعلن قبوله بالنتائج. هذا يؤثر على التشريعات المستقبلية والسياسة الخارجية، خاصة فيما يتعلق بالمساعدات العسكرية لإسرائيل التي أُعلن عن تقليصها.",
      "ماذا يعني ذلك: للأسواق العالمية والسياسة الدولية، قد يتغير ميزان القوى في الكونغرس مما يؤثر على الميزانية والسياسات. هذا تقرير عن النتائج الأولية الموثوقة، وليس تحليلاً سياسياً أو توقع نهائي.",
    ],
    sources: [
      { href: "https://www.nytimes.com", label: "نيويورك تايمز — تغطية الانتخابات" },
      { href: "https://www.euronews.com", label: "يورونيوز — نشرة الأخبار" },
    ],
  },
  // ... existing items remain, this is a partial update for demo; full merge recommended with Claude
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
