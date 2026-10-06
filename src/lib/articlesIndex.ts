/** Evergreen value articles — independent of daily news/events. Newest first. */

export type ArticleSource = { href: string; label: string };

export type ArticleItem = {
  slug: string;
  title: string;
  dateIso: string;
  dateLabel: string;
  category: string;
  description: string;
  readMinutes: number;
  paragraphs: string[];
  takeaways: string[];
  sources?: ArticleSource[];
  imageUrl?: string;
};

export const ARTICLE_ITEMS: ArticleItem[] = [
  {
    slug: "read-the-brief-before-the-source",
    title: "لماذا نكتب ملخص الخبر عندنا قبل رابط المصدر؟",
    dateIso: "2026-10-07",
    dateLabel: "7 أكتوبر 2026",
    category: "محو الأمية الإعلامية",
    imageUrl:
      "https://images.unsplash.com/photo-1504711434969-e33886168f5c?auto=format&fit=crop&w=1200&q=80",
    description:
      "كيف تقرأ خبر اليوم في شام AI: ثلاث جمل، ثم المصدر، ثم أداة التحقق. بدون نسخ المقالات.",
    readMinutes: 4,
    paragraphs: [
      "صفحة الأخبار في شام AI ليست وكالة. الشريط العاجل يُحيل إلى المصدر، لكن خبر اليوم يبقى هنا: ماذا حدث، لماذا يهم، وماذا تفعل قبل أن تخرج.",
      "هذا يمنع الخروج الفوري من عنوان منقول. إن غاب المصدر أو تغيّر الرقم بعد ساعة، الملخص يقول ذلك بدل أن يثبت رقماً غير مؤكد.",
      "بعد القراءة افتح المصدرين، ثم راجع إلى خطوات التحقق الخمس قبل المشاركة. إن كنت تجهز منشور متجر، ضغط صورة المنتج من المتصفح قبل رفعها.",
      "الفيديو المرفق هو بث المصدر على يوتيوب، لا إعادة بث من شام AI. إن لم يعمل المشغّل افتح الرابط.",
    ],
    takeaways: [
      "الملخص عندنا، والتفاصيل عند المصدر",
      "لا تشارك رقماً لم يُذكر مصدره",
      "خطوات التحقق قبل زر المشاركة",
      "صورة المنتج الثقيلة تُضغط قبل النشر",
    ],
    sources: [
      { href: "https://ttbik.vercel.app/news/oct-7-2026-what-sources-say", label: "خبر اليوم — 7 أكتوبر" },
      { href: "https://ttbik.vercel.app/articles/verify-news-before-share", label: "كيف تتحقق من خبر قبل مشاركته" },
      { href: "https://ttbik.vercel.app/free-tools/image-optimizer", label: "أداة ضغط الصور" },
      { href: "https://www.youtube.com/watch?v=ieHD2KktCZA", label: "بث بي بي سي عربي على يوتيوب" },
    ],
  },
];

export function getArticle(slug: string): ArticleItem | undefined {
  return ARTICLE_ITEMS.find((a) => a.slug === slug);
}

export function latestArticles(n = 6): ArticleItem[] {
  return ARTICLE_ITEMS.slice(0, n);
}
