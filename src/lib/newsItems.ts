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
    title: "ثغرات حرجة في PHP تُجبر ملايين المواقع على التحديث العاجل في أكتوبر 2026",
    dateIso: "2026-10-22",
    dateLabel: "22 أكتوبر 2026",
    imageUrl: "https://images.unsplash.com/photo-1555066931-4365d14bab8c?auto=format&fit=crop&w=1200&q=80",
    description: "ثغرتان في محرك PHP تسمحان بتنفيذ كود عن بعد دون تسجيل دخول. التحديثات الطارئة جارية، والملخص يعتمد على تقارير أمنية موثقة.",
    paragraphs: [
      "ماذا حدث: في أكتوبر 2026 اكتُشفت ثغرتان حرجتان في PHP (CVE-2026-109618 وCVE-2026-109619) تتيحان لمهاجم تنفيذ كود على الخادم دون الحاجة إلى بيانات اعتماد. الثغرات استُغلت بعد أن ساعد باحثون في تحويل أخطاء قديمة في المحرك إلى هجمات عملية.",
      "لماذا يهم: PHP يشغّل نسبة كبيرة من المواقع، بما فيها مواقع عربية صغيرة. التأخر في التحديث يعرّض البيانات والزوار للخطر. التقارير الأمنية تشير إلى إغلاق مواقع مؤقتاً أثناء التصحيح.",
      "ماذا تفعل: تحقق من إصدار PHP على استضافتك وطبّق التحديث الرسمي فوراً. لا تعتمد على ملخصات؛ افتح تنبيه الأمان من المصدر أو مزود الاستضافة. هذا ملخص وليس دليل اختراق.",
    ],
    sources: [
      { href: "https://www.theguardian.com/technology/2026/oct/21/php-flaw-websites-shutdown", label: "الغارديان — تغطية الثغرات" },
      { href: "https://www.php.net/", label: "موقع PHP الرسمي — التنبيهات الأمنية" },
    ],
  }
];