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
    slug: "european-day-of-languages-coverage-2026",
    title: "اليوم الأوروبي للغات 2026: ماذا تعني المناسبة للقارئ العربي؟",
    dateIso: "2026-09-26",
    dateLabel: "26 سبتمبر 2026",
    description:
      "تغطية تعريفية بمناسبة 26 سبتمبر من مصادر رسمية أوروبية ومرجع عربي، دون خلط بالسياسة المحلية.",
    paragraphs: [
      "في 26 سبتمبر من كل عام يُحتفل باليوم الأوروبي للغات، مبادرة مشتركة بين مجلس أوروبا والاتحاد الأوروبي انطلقت بعد إعلان 2001. الهدف التوعوي: تشجيع تعلم اللغات وإبراز التنوع اللغوي — وليست عطلة رسمية ملزمة.",
      "مواد المفوضية الأوروبية تشير إلى 24 لغة رسمية للاتحاد، وإلى فعاليات تعليمية وثقافية تنظمها مدارس ومعاهد. ويكيبيديا العربية تلخص الأهداف ذاتها: التعدد اللغوي والتواصل بين الثقافات.",
      "للقارئ العربي: المناسبة فرصة لفهم كيف تتعامل مؤسسات كبيرة مع تعدد اللغات في الواجهات والخدمات. لا ننسب تصريحات لحكومات عربية غير واردة في المصادر أدناه.",
      "هذا ملخص تعريفي بمصادر قابلة للفتح؛ للاطلاع على التفاصيل راجع الروابط الأصلية.",
    ],
    sources: [
      {
        href: "https://translation.ec.europa.eu/get-involved-european-language-activities-and-initiatives/26-september-european-day-languages_en",
        label: "المفوضية الأوروبية — European Day of Languages",
      },
      {
        href: "https://ar.wikipedia.org/wiki/%D8%A7%D9%84%D9%8A%D9%88%D9%85_%D8%A7%D9%84%D8%A3%D9%88%D8%B1%D9%88%D8%A8%D9%8A_%D9%84%D9%84%D8%BA%D8%A7%D8%AA",
        label: "ويكيبيديا العربية — اليوم الأوروبي للغات",
      },
    ],
  },
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
export function newsSitemapEntries(nowMs = Date.now()): NewsSitemapEntry[] {
  return NEWS_ITEMS.filter((n) => {
    const t = Date.parse(n.dateIso + "T00:00:00Z");
    if (Number.isNaN(t)) return false;
    return nowMs - t <= MS_48H && nowMs >= t - 12 * 3600_000;
  }).map((n) => ({
    path: `/news/${n.slug}`,
    title: n.title,
    dateIso: n.dateIso,
  }));
}
