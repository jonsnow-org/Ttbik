"""
Curated Arabic seed sources for the Sham crawler (additive, 2026-10-16).

Used by autonomous_pipeline.run_autonomous_cycle ONLY when a cycle's normal
search-driven crawl added nothing: it rotates through extra search topics and
these seed URLs so a cycle still finds allowed pages. robots.txt is NEVER
bypassed -- every URL still goes through web_access.real_fetch, which checks
robots.txt for this crawler's user agent before any request.

VERIFIED_SEEDS were checked live on 2026-10-16: robots.txt fetched and the
exact URL allowed for web_access.USER_AGENT, and the page returned HTTP 200.
WIKI_TITLES build /wiki/<title> URLs on ar.wikipedia.org (the same path
pattern verified allowed). Disable with SHAM_SEED_ROTATION=0.
"""
from __future__ import annotations

from urllib.parse import quote

VERIFIED_SEEDS: list[str] = [
    "https://ar.wikipedia.org/wiki/%D8%A7%D9%84%D8%B5%D9%81%D8%AD%D8%A9_%D8%A7%D9%84%D8%B1%D8%A6%D9%8A%D8%B3%D9%8A%D8%A9",
    "https://ar.wikipedia.org/wiki/%D8%AF%D9%85%D8%B4%D9%82",
    "https://ar.wikisource.org/wiki/%D8%A7%D9%84%D8%B5%D9%81%D8%AD%D8%A9_%D8%A7%D9%84%D8%B1%D8%A6%D9%8A%D8%B3%D9%8A%D8%A9",
    "https://ar.wikinews.org/wiki/%D8%A7%D9%84%D8%B5%D9%81%D8%AD%D8%A9_%D8%A7%D9%84%D8%B1%D8%A6%D9%8A%D8%B3%D9%8A%D8%A9",
    "https://ar.wikibooks.org/wiki/%D8%A7%D9%84%D8%B5%D9%81%D8%AD%D8%A9_%D8%A7%D9%84%D8%B1%D8%A6%D9%8A%D8%B3%D9%8A%D8%A9",
    "https://ar.wikiquote.org/wiki/%D8%A7%D9%84%D8%B5%D9%81%D8%AD%D8%A9_%D8%A7%D9%84%D8%B1%D8%A6%D9%8A%D8%B3%D9%8A%D8%A9",
    "https://ar.wiktionary.org/wiki/%D8%A7%D9%84%D8%B5%D9%81%D8%AD%D8%A9_%D8%A7%D9%84%D8%B1%D8%A6%D9%8A%D8%B3%D9%8A%D8%A9",
    "https://ar.wikiversity.org/wiki/%D8%A7%D9%84%D8%B5%D9%81%D8%AD%D8%A9_%D8%A7%D9%84%D8%B1%D8%A6%D9%8A%D8%B3%D9%8A%D8%A9",
    "https://ar.wikivoyage.org/wiki/%D8%A7%D9%84%D8%B5%D9%81%D8%AD%D8%A9_%D8%A7%D9%84%D8%B1%D8%A6%D9%8A%D8%B3%D9%8A%D8%A9",
    "https://www.gutenberg.org/browse/languages/ar",
    "https://www.aljazeera.net/",
    "https://www.aljazeera.net/news/",
    "https://www.aljazeera.net/science/",
    "https://www.bbc.com/arabic",
    "https://www.skynewsarabia.com/",
    "https://www.france24.com/ar/",
    "https://www.dw.com/ar/",
    "https://arabic.rt.com/",
    "https://www.independentarabia.com/",
    "https://arabic.cnn.com/",
    "https://www.aa.com.tr/ar",
    "https://www.trtarabi.com/",
    "https://www.annahar.com/",
    "https://www.youm7.com/",
    "https://www.masrawy.com/",
    "https://www.alaraby.co.uk/",
    "https://aawsat.com/",
    "https://www.okaz.com.sa/",
    "https://www.albayan.ae/",
    "https://www.alkhaleej.ae/",
    "https://www.emaratalyoum.com/",
    "https://www.hespress.com/",
    "https://www.elkhabar.com/",
    "https://www.spa.gov.sa/",
    "https://www.wam.ae/ar",
    "https://sana.sy/",
    "https://news.un.org/ar/",
    "https://www.un.org/ar/",
    "https://www.unesco.org/ar",
    "https://www.worldbank.org/ar/home",
    "https://www.data.gov.qa/",
    "https://bayanat.ae/",
    "https://mawdoo3.com/",
    "https://www.arageek.com/",
    "https://www.mominoun.com/",
    "https://arab48.com/",
    "https://www.alittihad.ae/",
    "https://www.al-watan.com/",
    "https://www.aljazeera.net/midan/"
]

WIKI_TITLES: list[str] = [
    "دمشق",
    "حلب",
    "بغداد",
    "القاهرة",
    "مكة_المكرمة",
    "القدس",
    "بيروت",
    "عمان",
    "الرياض",
    "تونس_(مدينة)",
    "الرباط",
    "الجزائر_(مدينة)",
    "اللغة_العربية",
    "النحو_العربي",
    "الشعر_العربي",
    "المتنبي",
    "ابن_خلدون",
    "ابن_سينا",
    "الخوارزمي",
    "الجبر",
    "الرياضيات",
    "الفيزياء",
    "الكيمياء",
    "علم_الأحياء",
    "الفلك",
    "الطب",
    "التاريخ",
    "الجغرافيا",
    "الفلسفة",
    "علم_النفس",
    "الاقتصاد",
    "الحاسوب",
    "البرمجة",
    "الإنترنت",
    "الذكاء_الاصطناعي",
    "تعلم_الآلة",
    "قاعدة_بيانات",
    "نظام_تشغيل",
    "الطاقة_الشمسية",
    "الماء",
    "النفط",
    "الزراعة",
    "نهر_النيل",
    "نهر_الفرات",
    "البحر_الأبيض_المتوسط",
    "الصحراء_الكبرى",
    "الدولة_الأموية",
    "الدولة_العباسية",
    "الأندلس",
    "الحرب_العالمية_الثانية",
    "الثورة_الصناعية",
    "الأمم_المتحدة",
    "كرة_القدم",
    "الموسيقى_العربية",
    "الخط_العربي",
    "العمارة_الإسلامية",
    "ألف_ليلة_وليلة",
    "نجيب_محفوظ",
    "طه_حسين",
    "جبران_خليل_جبران",
    "محمود_درويش",
    "الصحة_العامة",
    "التغذية",
    "اللقاح",
    "القلب",
    "الدماغ",
    "الخلية",
    "الحمض_النووي_الريبوزي_منقوص_الأكسجين",
    "التطور",
    "الكون",
    "المجموعة_الشمسية",
    "القمر",
    "الأرض",
    "المناخ",
    "الاحتباس_الحراري",
    "الزلزال",
    "البركان"
]

EXTRA_TOPICS_AR: list[str] = [
    "تاريخ الحضارة العربية الإسلامية",
    "قواعد النحو العربي للمبتدئين",
    "شرح مبسط لنظرية النسبية",
    "كيف تعمل الشبكات العصبية",
    "أساسيات البرمجة بلغة بايثون",
    "الأمن السيبراني للمستخدمين",
    "الطاقة المتجددة في الوطن العربي",
    "التغذية الصحية للأطفال",
    "الإسعافات الأولية الأساسية",
    "علم الفلك للهواة",
    "تاريخ الأندلس",
    "الأدب العربي الحديث",
    "الشعر الجاهلي",
    "الاقتصاد الرقمي",
    "ريادة الأعمال الناشئة",
    "التعليم عن بعد",
    "تقنيات الزراعة الحديثة",
    "إدارة الموارد المائية",
    "التغير المناخي وآثاره",
    "الصحة النفسية",
    "تاريخ الطب عند العرب",
    "الرياضيات في الحضارة الإسلامية",
    "الكيمياء العضوية مبسطة",
    "علم الوراثة",
    "الفضاء والأقمار الصناعية",
    "السيارات الكهربائية",
    "الهواتف الذكية وأنظمة التشغيل",
    "قواعد البيانات للمبتدئين",
    "تطوير تطبيقات الويب",
    "الحوسبة السحابية",
    "معالجة اللغة الطبيعية",
    "الترجمة الآلية",
    "تاريخ الخط العربي",
    "العمارة الإسلامية",
    "المطبخ العربي التقليدي",
    "السياحة في البلدان العربية",
    "تاريخ دمشق",
    "تاريخ بغداد",
    "تاريخ القاهرة",
    "الجغرافيا الطبيعية للوطن العربي",
    "الحيوانات في الصحراء",
    "النباتات الطبية",
    "الأمراض المزمنة والوقاية منها",
    "الرياضة واللياقة البدنية",
    "تاريخ كرة القدم",
    "الفلسفة الإسلامية",
    "علم الاجتماع",
    "مهارات التواصل",
    "تربية الأطفال",
    "حقوق الإنسان",
    "القانون الدولي",
    "الاقتصاد الإسلامي",
    "البورصة والاستثمار",
    "الذكاء الاصطناعي في الطب",
    "الروبوتات",
    "الطباعة ثلاثية الأبعاد",
    "الطاقة النووية السلمية",
    "البيئة وإعادة التدوير",
    "المحيطات والبحار",
    "الزلازل والبراكين",
    "أخبار العلوم والتقنية",
    "أخبار الاقتصاد العربي",
    "أخبار الصحة",
    "أخبار الثقافة والفنون"
]


def wiki_title_urls() -> list[str]:
    return [f"https://ar.wikipedia.org/wiki/{quote(t)}" for t in WIKI_TITLES]


def all_seed_urls() -> list[str]:
    return VERIFIED_SEEDS + wiki_title_urls()


def seed_urls_for_cycle(cycle: int, n: int = 8) -> list[str]:
    """Rotating window of seeds: half news/portal seeds (fresh daily), half
    encyclopedia articles, so consecutive cycles try different pages."""
    a, b = VERIFIED_SEEDS, wiki_title_urls()
    h = max(1, n // 2)
    return [a[(cycle * h + i) % len(a)] for i in range(h)] + [b[(cycle * h + i) % len(b)] for i in range(n - h)]


def extra_topics_for_cycle(cycle: int, n: int = 3) -> list[str]:
    t = EXTRA_TOPICS_AR
    return [t[(cycle * n + i) % len(t)] for i in range(n)]
