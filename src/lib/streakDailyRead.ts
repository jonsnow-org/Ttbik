/**
 * Daily reading for the chains bot (STREAK_BOT). One short piece per UTC day, the same piece in the chat and the Mini App.
 * The user reads it, then «قرأت اليوم» checks in the existing «reading» streak (checkInCore). No new table, no paid API.
 * Ayah text is the verse itself with its surah and number. The line under it is an original note, not a scholarly tafsir.
 * The single hadith is the well-known opening of the first hadith in Bukhari and Muslim. Tips are original.
 */
import type { Bot as TelegramBot } from "grammy";
import type { Bot as BotRow } from "@prisma/client";
import { checkInCore, ensureStreakUser } from "@/lib/streakBotLogic";

export const READ_CATEGORY = "reading";
export const READ_CALLBACK = "dr";

export type DailyRead = {
  id: string;
  kind: "ayah" | "hadith" | "tip";
  kicker: string;
  title: string;
  body: string;
  takeaway: string;
};

export const DAILY_READS: DailyRead[] = [
  {
    id: "ayah-inshirah",
    kind: "ayah",
    kicker: "آية · الشرح 5–6",
    title: "مع العسر يسر",
    body: "﴿فَإِنَّ مَعَ الْعُسْرِ يُسْرًا ۝ إِنَّ مَعَ الْعُسْرِ يُسْرًا﴾",
    takeaway: "العسر واحد في الآيتين، واليسر ذُكر مرتين. ضيق اليوم ليس آخر الخبر.",
  },
  {
    id: "tip-in-an",
    kind: "tip",
    kicker: "فائدة · لغة",
    title: "إن وأن في جملة",
    body: "بعد «قال» تُكسر الهمزة: قال إنه تأخر.\nبعد «أرجو» و«أظن» تُفتح: أرجو أن يحضر.",
    takeaway: "إذا استطعت أن تضع «قال» قبل الجملة فهمزتها مكسورة.",
  },
  {
    id: "ayah-ilm",
    kind: "ayah",
    kicker: "آية · طه 114",
    title: "زدني علماً",
    body: "﴿وَقُل رَّبِّ زِدْنِي عِلْمًا﴾",
    takeaway: "الزيادة المطلوبة علم، لا مجرد انتهاء اليوم. صفحة واحدة تكفي ليُحسب اليوم.",
  },
  {
    id: "tip-water",
    kind: "tip",
    kicker: "فائدة · جسم",
    title: "الماء قبل القهوة",
    body: "اشرب كأساً من الماء قبل أول قهوة. القهوة لا تعوّض سوائل الليل، والماء أولاً يخفف الصداع الذي يظنه الناس جوعاً.",
    takeaway: "كأس ماء، ثم القهوة. لا حاجة لروتين أطول من ذلك.",
  },
  {
    id: "ayah-wus",
    kind: "ayah",
    kicker: "آية · البقرة 286",
    title: "بقدر وسعك",
    body: "﴿لَا يُكَلِّفُ اللَّهُ نَفْسًا إِلَّا وُسْعَهَا﴾",
    takeaway: "ما لا تطيقه اليوم لا يُطلب منك كله. افعل الجزء الذي تستطيع إتمامه فعلاً.",
  },
  {
    id: "tip-25",
    kind: "tip",
    kicker: "فائدة · تركيز",
    title: "خمس وعشرون دقيقة مغلقة",
    body: "اغلق الإشعارات لخمس وعشرين دقيقة واعمل على شيء واحد. بعد ذلك خمس دقائق بلا شاشة. الساعة ليست هي المهمة، قطع التبديل بين المهام هو المهم.",
    takeaway: "مؤقت واحد، مهمة واحدة، ثم تمشي أو تشرب ماء.",
  },
  {
    id: "hadith-niyyah",
    kind: "hadith",
    kicker: "حديث · البخاري ومسلم",
    title: "الأعمال بالنيات",
    body: "«إنما الأعمال بالنيات، وإنما لكل امرئ ما نوى.»",
    takeaway: "قبل أن تبدأ، سمِّ ما تفعله في نفسك. العمل نفسه لا يتغير، والذي يتغير هو لماذا بدأته.",
  },
  {
    id: "tip-spend",
    kind: "tip",
    kicker: "فائدة · مال",
    title: "سطر مصروف واحد",
    body: "قبل النوم اكتب سطراً واحداً: ماذا خرج من جيبك اليوم، وبكم. لا تطبيق، لا تصنيف. السطر وحده يكفي لترى التسرب بعد أسبوع.",
    takeaway: "سطر في ملاحظة الهاتف. إن نسيت يوماً، اكتب أمس غداً ولا تترك السلسلة.",
  },
  {
    id: "ayah-change",
    kind: "ayah",
    kicker: "آية · الرعد 11",
    title: "حتى يغيّروا",
    body: "﴿إِنَّ اللَّهَ لَا يُغَيِّرُ مَا بِقَوْمٍ حَتَّىٰ يُغَيِّرُوا مَا بِأَنفُسِهِمْ﴾",
    takeaway: "التغيير المطلوب يبدأ بفعل صغير تعيده، لا بانتظار ظرف مختلف.",
  },
  {
    id: "tip-page",
    kind: "tip",
    kicker: "فائدة · قراءة",
    title: "صفحة لا فصل",
    body: "إن كان الكتاب ثقيلاً، اقرأ صفحة واحدة وتوقف عند آخر سطر مفهوم. وضع علامة هناك. غداً تبدأ من العلامة، لا من أول الفصل.",
    takeaway: "الصفحة المكتملة أفضل من فصل تُفتح ولا يُغلق.",
  },
  {
    id: "ayah-dharra",
    kind: "ayah",
    kicker: "آية · الزلزلة 7–8",
    title: "مثقال ذرة",
    body: "﴿فَمَن يَعْمَلْ مِثْقَالَ ذَرَّةٍ خَيْرًا يَرَهُ ۝ وَمَن يَعْمَلْ مِثْقَالَ ذَرَّةٍ شَرًّا يَرَهُ﴾",
    takeaway: "الذرة تُرى. الخير الصغير الذي تكرره لا يضيع، وكذلك التهاون الصغير.",
  },
  {
    id: "tip-walk",
    kind: "tip",
    kicker: "فائدة · حركة",
    title: "عشر دقائق بعد الأكل",
    body: "بعد أكبر وجبة في اليوم، امشِ عشر دقائق داخل البيت أو خارجه. لا سرعة، لا مسافة. الهدف أن لا تجلس فوراً.",
    takeaway: "عشر دقائق تُحسب رياضة اليوم إن لم تستطع أكثر.",
  },
  {
    id: "ayah-ikhlas",
    kind: "ayah",
    kicker: "آية · الإخلاص",
    title: "سورة قصيرة كاملة",
    body: "﴿قُلْ هُوَ اللَّهُ أَحَدٌ ۝ اللَّهُ الصَّمَدُ ۝ لَمْ يَلِدْ وَلَمْ يُولَدْ ۝ وَلَمْ يَكُن لَّهُ كُفُوًا أَحَدٌ﴾",
    takeaway: "اقرأها مرة بتمهل. إن كانت صلاتك اليوم ناقصة، هذه السورة بداية صالحة لا تحتاج ترتيباً طويلاً.",
  },
  {
    id: "tip-sleep",
    kind: "tip",
    kicker: "فائدة · نوم",
    title: "إن لم تنم خلال عشرين دقيقة",
    body: "إذا بقيت مستيقظاً في السرير نحو عشرين دقيقة، قم إلى ضوء خافت واقرأ ورقة حتى يثقل جفنك، ثم عد. البقاء في السرير وأنت تتقلب يعلّم الجسم أن السرير مكان قلق.",
    takeaway: "السرير للنوم. إن فات النوم، غادره قليلاً ثم عد.",
  },
  {
    id: "ayah-tawfiq",
    kind: "ayah",
    kicker: "آية · هود 88",
    title: "ما توفيقي إلا بالله",
    body: "﴿وَمَا تَوْفِيقِي إِلَّا بِاللَّهِ﴾",
    takeaway: "قلها عند بدء عمل تخاف أن يفلت منك، ثم ابدأ بالخطوة الأولى لا بالقلق كله.",
  },
  {
    id: "tip-fajr",
    kind: "tip",
    kicker: "فائدة · صلاة",
    title: "صلاتان لا تفوتان",
    body: "إن صعب عليك ضبط الخمس دفعة واحدة، ثبّت الفجر والمغرب هذا الأسبوع فقط. لهما علامتان واضحتان: قبل الشروق، وعند اختفاء الشمس. الباقي يُبنى عليهما.",
    takeaway: "علامتان في اليوم أقوى من نية عامة بلا موعد.",
  },
  {
    id: "ayah-dhikr",
    kind: "ayah",
    kicker: "آية · الرعد 28",
    title: "تطمئن القلوب",
    body: "﴿أَلَا بِذِكْرِ اللَّهِ تَطْمَئِنُّ الْقُلُوبُ﴾",
    takeaway: "إذا ضاق الصدر، اذكر الله بلسانك دقيقة واحدة قبل أن تفتح الهاتف.",
  },
  {
    id: "tip-fast",
    kind: "tip",
    kicker: "فائدة · صيام",
    title: "كيف تبدأ صيام الاثنين",
    body: "تسحّر ولو تمرات وماء، ونوِ قبل الفجر. إن خفت من العمل، اختر الاثنين لا الخميس إن كان أخف. الإفطار على ماء ثم طعام، لا على حلويات أولاً.",
    takeaway: "نية قبل الفجر، وماء عند الإفطار. هذا يكفي لأول مرة.",
  },
  {
    id: "ayah-kawthar",
    kind: "ayah",
    kicker: "آية · الكوثر",
    title: "سورة الكوثر",
    body: "﴿إِنَّا أَعْطَيْنَاكَ الْكَوْثَرَ ۝ فَصَلِّ لِرَبِّكَ وَانْحَرْ ۝ إِنَّ شَانِئَكَ هُوَ الْأَبْتَرُ﴾",
    takeaway: "السورة قصيرة. اقرأها في ركعتين خفيفتين إن فاتك ورد أطول.",
  },
  {
    id: "tip-password",
    kind: "tip",
    kicker: "فائدة · تقنية",
    title: "كلمة سر واحدة اليوم",
    body: "اختر حساباً واحداً مهمته عالية (البريد أو البنك) وغيّر كلمته إلى جملة طويلة لا تستخدمها في مكان آخر. لا تغيّر كل الحسابات في يوم واحد، حساب واحد يكفي.",
    takeaway: "حساب واحد، جملة طويلة، ولا تُعاد في غيره.",
  },
  {
    id: "ayah-asr",
    kind: "ayah",
    kicker: "آية · العصر",
    title: "سورة العصر",
    body: "﴿وَالْعَصْرِ ۝ إِنَّ الْإِنسَانَ لَفِي خُسْرٍ ۝ إِلَّا الَّذِينَ آمَنُوا وَعَمِلُوا الصَّالِحَاتِ وَتَوَاصَوْا بِالْحَقِّ وَتَوَاصَوْا بِالصَّبْرِ﴾",
    takeaway: "أربع خصال تخرج من الخسر: إيمان، عمل، حق، صبر. اختر واحدة منها ونفّذها اليوم بفعل واحد.",
  },
  {
    id: "tip-reply",
    kind: "tip",
    kicker: "فائدة · شغل",
    title: "ردّ واحد معلّق",
    body: "افتح الرسائل وابحث عن أقدم رسالة تنتظر رداً منك. اكتب ثلاثة أسطر: ماذا فهمت، ماذا ستفعل، ومتى. أرسلها. لا ترتب صندوق الوارد كله.",
    takeaway: "رد واحد قديم أغلى من عشر رسائل جديدة تُقرأ وتُترك.",
  },
  {
    id: "ayah-dhkuruni",
    kind: "ayah",
    kicker: "آية · البقرة 152",
    title: "فاذكروني أذكركم",
    body: "﴿فَاذْكُرُونِي أَذْكُرْكُمْ﴾",
    takeaway: "الذكر هنا يبدأ منك. كلمة صادقة الآن، لا ورد مؤجل إلى الليل.",
  },
  {
    id: "tip-sun",
    kind: "tip",
    kicker: "فائدة · نهار",
    title: "ضوء قبل الشاشة",
    body: "في أول نصف ساعة بعد الاستيقاظ، انظر إلى ضوء النافذة أو اخرج دقيقة قبل أن تفتح هاتفك. الضوء الصباحي يثبّت موعد النوم أكثر من أي منبه ليلي.",
    takeaway: "نافذة أولاً، ثم الهاتف.",
  },
  {
    id: "tip-hamza",
    kind: "tip",
    kicker: "فائدة · لغة",
    title: "همزة الوصل والقطع",
    body: "همزة «ابن» و«اسم» و«استغفر» تسقط في النطق إذا وُصلت بما قبلها: قل «بن» داخل الجملة. همزة «أحمد» و«إن» تُنطق دائماً.",
    takeaway: "إن نطقتها وأنت تبدأ بها من الصفر بعد «و»، فغالباً هي همزة قطع.",
  },
  {
    id: "tip-plate",
    kind: "tip",
    kicker: "فائدة · أكل",
    title: "نصف الطبق خضار",
    body: "في وجبة الغداء املأ نصف الطبق بخضار أو سَلطة قبل أن تضع الأرز أو الخبز. لا تحذف النشويات. الترتيب يقلل الكمية دون أن تشعر أنك في حمية.",
    takeaway: "الخضار أولاً على الطبق، لا كطبق إضافي تنساه.",
  },
  {
    id: "tip-two-min",
    kind: "tip",
    kicker: "فائدة · عادة",
    title: "قاعدة الدقيقتين",
    body: "إن كان العمل يأخذ أقل من دقيقتين (رد، ترتيب كأس، رفع ملف)، افعله الآن. ما يأخذ أكثر من ذلك اكتبه في سطر ولا تبدأ فيه حتى تفرغ المهمة الحالية.",
    takeaway: "دقيقتان الآن، أو سطر للغد. لا وسط بينهما.",
  },
  {
    id: "tip-voice",
    kind: "tip",
    kicker: "فائدة · تعلم",
    title: "اقرأ بصوت مسموع سطراً",
    body: "إذا حفظت شيئاً اليوم (آية، كلمة، رقم)، انطقه بصوت تسمعه أنت. القراءة الصامتة تُوهمك أنك حفظت. الصوت يكشف موضع التعثر.",
    takeaway: "سطر واحد بصوت عالٍ يكفي لاختبار الحفظ.",
  },
  {
    id: "tip-bag",
    kind: "tip",
    kicker: "فائدة · بيت",
    title: "جهّز الغد في دقيقتين",
    body: "قبل النوم ضع في مكان واحد: المفتاح، والبطاقة، وما ستلبسه. الصباح يضيع في البحث لا في الاستعداد.",
    takeaway: "كومة واحدة عند الباب تغني عن عشر دقائق تخبط.",
  },
  {
    id: "tip-no-scroll",
    kind: "tip",
    kicker: "فائدة · هاتف",
    title: "لا تمرير في أول ربع ساعة",
    body: "أول خمس عشرة دقيقة بعد الاستيقاظ بلا تمرير. الوضوء، الماء، وشيء واحد تعرفه من البارحة. التمرير أول النهار يسرق المهمة التي نويت أن تبدأ بها.",
    takeaway: "ربع ساعة. بعدها الهاتف مباح.",
  },
];

const dayNumber = (d = new Date()) => Math.floor(d.getTime() / 86_400_000);

/** The reading of a UTC day. Pure. The bank is walked in order and then repeats. */
export function dailyReadFor(now = new Date()): DailyRead {
  const n = DAILY_READS.length;
  const i = ((dayNumber(now) % n) + n) % n;
  return DAILY_READS[i];
}

export function dailyReadText(now = new Date()): string {
  const c = dailyReadFor(now);
  return [`📖 قراءة اليوم · ${c.kicker}`, "", c.title, "", c.body, "", c.takeaway, "", "سجّل قراءتك ليُحسب يوم في سلسلة القراءة."].join("\n");
}

/** Inline button «قرأت اليوم» (`dr`): the same check-in as the Mini App, on the reading chain. */
export async function handleDailyReadCallback(bot: TelegramBot, botRow: BotRow, cq: any): Promise<boolean> {
  if (String(cq?.data || "") !== READ_CALLBACK) return false;
  const toast = (text: string) => bot.api.answerCallbackQuery(cq.id, { text }).catch(() => null);
  const userId = String(cq.from?.id || "");
  if (!userId) { await toast("غير متاح."); return true; }
  const user = await ensureStreakUser(botRow.id, userId);
  if (user.isBanned || (user.mutedUntil && user.mutedUntil > new Date())) { await toast("غير متاح لك الآن."); return true; }
  const r = await checkInCore(botRow.id, userId, READ_CATEGORY);
  await toast(r.already ? "قرأتَ اليوم بالفعل، عد غداً" : `${r.continued ? "🔥" : "🌱"} سُجّلت القراءة. سلسلتك ${r.entry.currentStreak} يوم`);
  return true;
}
