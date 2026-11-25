// One-click Skills (the idea behind Mira's "Daily Briefing" / "Daily Motivation"): ready scheduled tasks a user switches on with one tap from the Mini App.
// Each preset becomes an ordinary scheduled task of the user's OWN account on the selected Nova-family model (src/lib/coderSchedules.ts): same plan limits,
// same per-user data, same owner deny-list and approvals as any task the user writes by hand. Pure data, no network.
export type SkillPreset = { id: string; icon: string; title: { ar: string; en: string }; desc: { ar: string; en: string }; prompt: string; recurrence: string; needsRepo?: boolean };

export const SKILL_PRESETS: SkillPreset[] = [
  {
    id: "daily-briefing", icon: "🗞️", recurrence: "daily 08:00",
    title: { ar: "الملخص الصباحي", en: "Morning briefing" },
    desc: { ar: "كل يوم 8:00: أهم أخبار التقنية والعالم العربي بمصادرها", en: "Daily 8:00: top tech and Arab-world news with sources" },
    prompt: "أعطني ملخصًا صباحيًا قصيرًا: أهم 5 أخبار اليوم في التقنية والذكاء الاصطناعي والعالم العربي، سطر لكل خبر مع رابط مصدره. لا تخترع خبرًا: إن لم تجد مصدرًا فاذكر ذلك. ثم نصيحة عملية واحدة لليوم.",
  },
  {
    id: "daily-motivation", icon: "🌱", recurrence: "daily 09:00",
    title: { ar: "تحفيز يومي", en: "Daily motivation" },
    desc: { ar: "كل يوم 9:00: رسالة تحفيز قصيرة وخطوة صغيرة", en: "Daily 9:00: a short motivation and one small step" },
    prompt: "اكتب لي رسالة تحفيز قصيرة (3 أسطر على الأكثر) ومختلفة عن الأيام السابقة، تنتهي بخطوة صغيرة واحدة أستطيع فعلها اليوم.",
  },
  {
    id: "weekly-review", icon: "🗓️", recurrence: "weekly sun 19:00",
    title: { ar: "مراجعة الأسبوع", en: "Weekly review" },
    desc: { ar: "كل أحد 19:00: ماذا أنجزنا وخطة الأسبوع القادم", en: "Sundays 19:00: what we did and next week's plan" },
    prompt: "راجع ما عملنا عليه في محادثاتنا هذا الأسبوع: ما أُنجز، وما بقي معلقًا. ثم اقترح خطة قصيرة من 3 أولويات للأسبوع القادم.",
  },
  {
    id: "github-digest", icon: "🐙", recurrence: "weekdays 09:30", needsRepo: true,
    title: { ar: "ملخص المستودع", en: "Repository digest" },
    desc: { ar: "أيام العمل 9:30: طلبات الدمج والقضايا الجديدة في مستودعك", en: "Weekdays 9:30: new pull requests and issues in your repo" },
    prompt: "لخّص ما تغيّر في مستودعي منذ أمس: طلبات الدمج الجديدة أو المحدَّثة، والقضايا الجديدة، وأي فحص CI فاشل. اقرأ فقط ولا تغيّر شيئًا.",
  },
  {
    id: "english-word", icon: "📚", recurrence: "daily 20:00",
    title: { ar: "كلمة إنجليزية يوميًا", en: "Daily English word" },
    desc: { ar: "كل يوم 20:00: كلمة جديدة بمعناها ومثال", en: "Daily 20:00: a new word, meaning and example" },
    prompt: "علّمني كلمة إنجليزية مفيدة جديدة لم تعلّمني إياها من قبل: الكلمة، النطق التقريبي بالعربية، المعنى، ومثال في جملة مع ترجمتها.",
  },
];

/** The schedule_create body of a preset for this user (their time zone; a repo only for the presets that need one). */
export function presetSchedule(p: SkillPreset, lang: "ar" | "en", tz: string, repo?: string): { kind: "cron"; title: string; prompt: string; recurrence: string; tz: string; repo?: string } {
  return { kind: "cron", title: `${p.icon} ${p.title[lang]}`, prompt: p.prompt, recurrence: p.recurrence, tz, ...(p.needsRepo && repo ? { repo } : {}) };
}
/** A preset is "on" when the user already has a task with its title (in either language). */
export const presetEnabled = (p: SkillPreset, titles: string[]): boolean => titles.some((t) => t === `${p.icon} ${p.title.ar}` || t === `${p.icon} ${p.title.en}`);
