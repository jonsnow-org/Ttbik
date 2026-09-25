/**
 * Public changelog for the Telegram channel (src/lib/channelPublisher.ts).
 *
 * Add an entry here whenever something ships that USERS will care about —
 * a new bot feature, a new tool, a fix they'd notice. The channel publisher
 * posts each entry once, automatically, at its next run.
 *
 * NEVER add here (this file is published word for word to a public channel):
 * - anything owner-only: admin panels, activation codes, creator passwords,
 *   moderation/report handling, stats, broadcast tools, env vars, SQL;
 * - infrastructure details: hosting, servers, outages, costs, secrets;
 * - Nova AI or "Sham" (owner directive 2026-09-21: never promoted publicly).
 * Write it the way a user would read it: what they can now do, and where.
 */
export type ChangelogEntry = {
  id: string; // stable, never reused
  date: string; // YYYY-MM-DD
  title: string;
  body: string; // 1–4 short lines, user-facing only
  url: string; // where the user goes to try it
};

export const CHANNEL_CHANGELOG: ChangelogEntry[] = [
  {
    id: "2026-09-24-guess-word",
    date: "2026-09-24",
    title: "🎯 لعبة جديدة: خمّن الكلمة",
    body: "كلمة عربية جديدة كل يوم وست محاولات لتخمينها، مع ألوان تدلّك على الحروف الصحيحة. شارك نتيجتك مع أصدقائك!",
    url: "https://ttbik.vercel.app/guess-word",
  },
  {
    id: "2026-09-25-blood-bank",
    date: "2026-09-25",
    title: "🩸 «نبض» — بنك دم فوري في البوت الطبي",
    body:
      "تحتاج دماً لمريض؟ انشر طلباً فيصل فوراً لكل متبرع بفصيلة متوافقة قريب منك.\n" +
      "تستطيع التبرع؟ سجّل فصيلتك لتصلك النداءات القريبة فقط، وأنقذ حياة بضغطة.",
    url: "https://t.me/Adsbyeadsbot",
  },
  {
    id: "2026-09-25-tenders",
    date: "2026-09-25",
    title: "🏷 «اطلب وهم يتنافسون» في بوت فرص العمل والمتجر",
    body:
      "اكتب ما تحتاجه مرة واحدة — سبّاك، مصمم، أو منتج معيّن — فتصلك عروض أسعار من المختصين في منطقتك.\n" +
      "العروض سرية فيقدّم كلٌّ أفضل سعر، وأنت تقارن وتختار.",
    url: "https://t.me/Saragptbotbot",
  },
  {
    id: "2026-09-25-confessions",
    date: "2026-09-25",
    title: "🎭 بوت الاعترافات المجهولة",
    body:
      "صندوقك الخاص لتصلك رسائل واعترافات مجهولة من أصدقائك.\n" +
      "ردّ عليها، تفاعل بـ ❤️ 😂 🔥، وتابع المحادثة دون أن تنكشف هوية أحد.",
    url: "https://t.me/ie3terafatbot",
  },
];
