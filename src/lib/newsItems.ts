export type NewsSource = { href: string; label: string };

export type NewsItem = {
  slug: string;
  title: string;
  dateIso: string;
  dateLabel: string;
  description: string;
  paragraphs: string[];
  sources: NewsSource[];
};

/** Authored news only. Newest first. Ticker RSS stays out. */
export const NEWS_ITEMS: NewsItem[] = [
  {
    slug: "trump-xi-summit-washington-2026",
    title: "القمة المقبلة بين ترمب وشي في واشنطن: اللقاء مقرر الخميس",
    dateIso: "2026-09-24",
    dateLabel: "24 سبتمبر 2026",
    description:
      "ما تقوله بي بي سي عربي والجزيرة نت عن القمة المقررة بين ترمب وشي في واشنطن. ملخص بمصدرين ودون نسخ المقالات.",
    paragraphs: [
      "ما تقوله المصادر: بي بي سي عربي وصفت اللقاء بأنه قمة مقبلة بين الرئيس الأميركي دونالد ترمب والرئيس الصيني شي جينبينغ، وذكرت أن الرجلين التقيا منتصف مايو/أيار الماضي عندما زار ترمب الصين، وأن زيارة شي ردّ على تلك الزيارة.",
      "الجزيرة نت (23 سبتمبر 2026) كتبت أن شي يصل واشنطن هذا الأسبوع في أول زيارة له إلى العاصمة الأميركية منذ 11 عاماً، وأن اللقاء وجهاً لوجه مقرر الخميس، في ثاني لقاء بينهما هذا العام، وسط ملفات التجارة والذكاء الاصطناعي والمعادن الحيوية وإيران وتايوان.",
      "لا نذكر دعوة إلى قمة العشرين أو أي طرف ثالث: لم يفتح أي مصدر أدناه مقالاً يؤكد ذلك.",
    ],
    sources: [
      {
        href: "https://www.bbc.com/arabic/articles/cq5yjz0512ryo",
        label: "بي بي سي عربي — ما الذي سيجري في القمة المقبلة بين ترامب وشي جينبينغ؟",
      },
      {
        href: "https://www.aljazeera.net/politics/2026/9/23/%d8%aa%d8%b1%d9%85%d8%a8-%d9%88%d8%b4%d9%8a-%d9%82%d9%85%d8%a9-%d9%85%d8%b9%d8%b1%d9%83%d8%a9-%d8%a7%d9%84%d8%b3%d8%ac%d8%a7%d8%af%d8%a9-%d8%a7%d9%84%d8%ad%d9%85%d8%b1%d8%a7%d8%a1-%d9%886",
        label: "الجزيرة نت — ترمب وشي.. قمة معركة السجادة الحمراء و6 ملفات",
      },
    ],
  },
];

export function getNewsItem(slug: string): NewsItem | undefined {
  return NEWS_ITEMS.find((n) => n.slug === slug);
}

/** Homepage «اليوم» strip — Claude wires this. */
export function latestNewsItem(): NewsItem | undefined {
  return NEWS_ITEMS[0];
}

const MS_48H = 48 * 60 * 60 * 1000;

export type NewsSitemapEntry = {
  path: string;
  title: string;
  dateIso: string;
};

/** Authored URLs only, last 48 hours from dateIso (UTC midnight of that date). */
export function newsSitemapEntries(now = new Date()): NewsSitemapEntry[] {
  const extra: NewsSitemapEntry[] = [
    {
      path: "/events/autumn-equinox-2026",
      title: "ما الذي نعرفه عن الاعتدال الخريفي 2026؟",
      dateIso: "2026-09-24",
    },
  ];
  const fromNews: NewsSitemapEntry[] = NEWS_ITEMS.map((n) => ({
    path: `/news/${n.slug}`,
    title: n.title,
    dateIso: n.dateIso,
  }));
  return [...fromNews, ...extra].filter((e) => {
    const published = Date.parse(`${e.dateIso}T00:00:00Z`);
    if (Number.isNaN(published)) return false;
    return now.getTime() - published <= MS_48H && now.getTime() >= published - 12 * 60 * 60 * 1000;
  });
}
