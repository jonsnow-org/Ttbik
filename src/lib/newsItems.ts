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
      "ماذا تفعل: اقرأ هذا الملخص ثم افتح المصدر. لا تشارك لقطة بلا رابط. شرح التحقق قبل المشاركة في مقال شام AI: https://ttbik.vercel.app/articles/verify-news-before-share وحدث اليوم في https://ttbik.vercel.app/events/world-space-week-2026",
      "البث المباشر لبي بي سي عربي متاح على يوتيوب إن تعطل التضمين في صفحة الأخبار. هذا ملخص تعريفي بمصدرين، ليس تغطية لحظة بلحظة.",
    ],
    sources: [
      {
        href: "https://www.youtube.com/watch?v=ieHD2KktCZA",
        label: "بي بي سي عربي — البث المباشر على يوتيوب",
      },
      {
        href: "https://www.bbc.com/arabic",
        label: "بي بي سي عربي — الموقع",
      },
      {
        href: "https://ttbik.vercel.app/articles/verify-news-before-share",
        label: "مقال شام AI — كيف تتحقق من خبر قبل مشاركته",
      },
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
