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
    slug: "mistral-large-4-preview-2026",
    title: "ميسترال تنشر معاينة Large 4: تريليون معامل والأوزان لاحقاً",
    dateIso: "2026-10-07",
    dateLabel: "7 أكتوبر 2026",
    imageUrl: "https://images.unsplash.com/photo-1620712943543-bcc4688e7485?auto=format&fit=crop&w=1200&q=80",
    description: "خبر قصير: معاينة نموذج فرنسي وُعدت أوزانه لاحقاً، بحجم إجمالي قرب تريليون معامل ونحو 49 ملياراً نشطة.",
    paragraphs: [
      "ماذا حدث: في 6 أكتوبر 2026 أطلق مختبر ميسترال معاينة Large 4، نموذجاً متعدد الوسائط من نوع خليط خبراء. التغطيات التقنية حددت الحجم الإجمالي قرب تريليون معامل، والمعاملات النشطة قرب 49 ملياراً، بعد تدريب من الصفر لنحو شهرين على قرابة 4000 وحدة Grace Blackwell في أوروبا.",
      "لماذا يهم: الأوزان وُعدت لنهاية أكتوبر ولم تُنشر مع المعاينة. من يبني أداة عربية لا يغيّر المزوّد قبل أن يرى الترخيص وسعر الطلب الفعلي.",
      "ماذا تفعل: اقرأ الملخص ثم افتح المصدر. الشرح الأطول في مقال شام AI المنفصل.",
    ],
    sources: [
      { href: "https://aiweekly.co/ai-news-today", label: "AI Weekly — 7 أكتوبر 2026" },
      { href: "https://ttbik.vercel.app/articles/mistral-large-4-open-weight-preview", label: "مقال شام AI — معاينة Large 4" },
    ],
  },
  {
    slug: "oct-7-2026-what-sources-say",
    title: "ماذا نتابع في 7 أكتوبر 2026؟ ملخص المصادر قبل الخروج",
    dateIso: "2026-10-07",
    dateLabel: "7 أكتوبر 2026",
    imageUrl:
      "https://images.unsplash.com/photo-1495020689067-958852a7765e?auto=format&fit=crop&w=1200&q=80",
    description:
      "خبر اليوم في شام AI: ثلاث جمل عما قالته المصادر حتى صباح 7 أكتوبر، ثم الرابط الأصلي. لا ننسخ المقالات.",
    paragraphs: [
      "ماذا حدث: حتى صباح 7 أكتوبر 2026 تتابع وكالات أنباء وبي بي سي عربي تطورات في اليمن ومضيق هرمز. العليمي أعلن بدء عملية عسكرية لاستعادة ما تبقى من أراضي اليمن، والقوات الحكومية اليمنية قالت إنها وجهت ضربات وصفتها بالحيوية ضد أهداف حوثية في صنعاء وصعدة. هذا نقل عن الجهات، لا تأكيد ميداني من شام AI.",
      "لماذا يهم: قاليباف قال إن هرمز لن يُفتح قبل استيفاء شروط، وهيئة بحرية بريطانية نقلت بلاغاً عن واقعة في المضيق. أي تغيير في الملاحة يمس الشحن وأسعار الطاقة. التفاصيل تتغير بسرعة، لذلك لا نثبت هنا أرقام إصابات أو خسائر.",
      "ماذا تفعل: اقرأ هذا الملخص ثم افتح المصدر. لا تشارك لقطة بلا رابط. شرح التحقق قبل المشاركة في مقال شام AI، وحدث اليوم هو الأسبوع العالمي للفضاء.",
      "البث المباشر لبي بي سي عربي متاح على يوتيوب إن تعطل التضمين في صفحة الأخبار. هذا ملخص تعريفي بمصدرين، ليس تغطية لحظة بلحظة.",
    ],
    sources: [
      { href: "https://www.youtube.com/watch?v=ieHD2KktCZA", label: "بي بي سي عربي — البث المباشر على يوتيوب" },
      { href: "https://www.bbc.com/arabic", label: "بي بي سي عربي — الموقع" },
      { href: "https://ttbik.vercel.app/articles/verify-news-before-share", label: "مقال شام AI — كيف تتحقق من خبر قبل مشاركته" },
      { href: "https://ttbik.vercel.app/events/world-space-week-2026", label: "حدث اليوم — الأسبوع العالمي للفضاء" },
    ],
  },
  {
    slug: "spacex-crew-13-iss-2026",
    title: "إطلاق Crew-13 إلى محطة الفضاء الدولية: ماذا نعرف؟",
    dateIso: "2026-10-01",
    dateLabel: "1 أكتوبر 2026",
    imageUrl:
      "https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?auto=format&fit=crop&w=1200&q=80",
    description:
      "ملخص عن مهمة SpaceX Crew-13 إلى محطة الفضاء الدولية وفق تقارير إعلامية عن الإطلاق من كيب كانافيرال، بمصادر قابلة للتحقق.",
    paragraphs: [
      "أفادت تقارير إخبارية في 1 أكتوبر 2026 بإطلاق مهمة SpaceX Crew-13 إلى محطة الفضاء الدولية من قاعدة كيب كانافيرال في فلوريدا، بطاقم يضم رائدي فضاء من ناسا ورائداً من روسكوزموس وآخر من وكالة الفضاء الكندية وفق ما نقلته وسائل إعلام عن الجداول المعلنة للرحلة.",
      "مهام Crew dragon جزء من برنامج النقل التجاري للطاقم مع ناسا. الهدف المعتاد: نقل رواد فضاء وإمدادات ودعم التجارب على المحطة، ثم العودة وفق جدول المهمة.",
      "لا نعيد هنا تفاصيل تقنية غير مؤكدة من مصادر غير رسمية. للاطلاع على أرقام الإطلاق والجدول الزمني راجع بيانات ناسا أو SpaceX أو التقارير الإخبارية المدرجة أدناه عند توفرها.",
      "هذا ملخص تعريفي للقارئ العربي المهتم بالفضاء؛ ليس بثاً مباشراً ولا تغطية لحظة بلحظة.",
    ],
    sources: [
      {
        href: "https://en.wikipedia.org/wiki/Portal:Current_events/2026_October_1",
        label: "ويكيبيديا — أحداث جارية 1 أكتوبر 2026 (Crew-13)",
      },
      {
        href: "https://www.nasa.gov/",
        label: "ناسا — الموقع الرسمي",
      },
    ],
  },
  {
    slug: "european-day-of-languages-coverage-2026",
    title: "اليوم الأوروبي للغات 2026: ماذا تعني المناسبة للقارئ العربي؟",
    dateIso: "2026-09-26",
    dateLabel: "26 سبتمبر 2026",
    imageUrl:
      "https://images.unsplash.com/photo-1456513080080-7e00c33a4e58?auto=format&fit=crop&w=1200&q=80",
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
        label: "وييبيديا العربية — اليوم الأوروبي للغات",
      },
    ],
  },
  {
    slug: "trump-xi-summit-washington-2026",
    title: "القمة المقبلة بين ترمب وشي في واشنطن: اللقاء مقرر الخميس",
    dateIso: "2026-09-24",
    dateLabel: "24 سبتمبر 2026",
    imageUrl:
      "https://images.unsplash.com/photo-1529107386315-e1a2ed48a620?auto=format&fit=crop&w=1200&q=80",
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
