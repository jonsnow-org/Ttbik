import type { Locale, SessionKind } from './types'

export interface SessionPrompt {
  kind: SessionKind
  title: string
  purpose: string
  question: string
}

const DAILY_PROMPTS: Record<Locale, SessionPrompt[]> = {
  ar: [
    { kind: 'knowledge', title: 'ما المهارة التي تستحق أن نتعلمها هذا الشهر؟', purpose: 'شاركوا مصادر وخطوات عملية تساعد المبتدئ على البدء خلال أسبوع.', question: 'تحدي اليوم: ما المهارة التي تستحق أن نتعلمها هذا الشهر؟' },
    { kind: 'decision', title: 'كيف نختار بين فرصة آمنة وفرصة واعدة؟', purpose: 'قارنوا المخاطر والعائد والوقت والمعايير التي تجعل القرار مناسباً.', question: 'تحدي اليوم: كيف نوازن بين الأمان والفرصة؟' },
    { kind: 'experience', title: 'كيف تجاوزت أصعب بداية في مشروع؟', purpose: 'شاركوا خطوات البداية والعقبات التي واجهتكم وما الذي ساعد فعلاً.', question: 'تحدي اليوم: شارك درساً من بداية صعبة.' },
    { kind: 'knowledge', title: 'ما أفضل طريقة لتنظيم الوقت دون إرهاق؟', purpose: 'اجمعوا أساليب قابلة للتطبيق وأمثلة واقعية، لا نصائح عامة فقط.', question: 'تحدي اليوم: كيف ننظم الوقت دون احتراق؟' },
    { kind: 'decision', title: 'هل نتعلم بعمق أم نتوسع في مهارات متعددة؟', purpose: 'ناقشوا متى يكون التخصص أفضل ومتى يكون الجمع بين المهارات مفيداً.', question: 'تحدي اليوم: التخصص أم تنوع المهارات؟' },
    { kind: 'experience', title: 'ما عادة صغيرة صنعت فرقاً كبيراً؟', purpose: 'صفوا العادة وكيف بدأتم بها وكيف حافظتم عليها والنتيجة التي لاحظتموها.', question: 'تحدي اليوم: عادة صغيرة، أثر كبير.' },
    { kind: 'knowledge', title: 'كيف نتحقق من صحة معلومة منتشرة؟', purpose: 'اقترحوا خطوات ومصادر وأسئلة تكشف المعلومة المضللة قبل نشرها.', question: 'تحدي اليوم: كيف نتحقق قبل أن نشارك؟' },
  ],
  en: [
    { kind: 'knowledge', title: 'Which skill is worth learning this month?', purpose: 'Share useful sources and practical steps that help a beginner get started within a week.', question: 'Daily challenge: Which skill is worth learning this month?' },
    { kind: 'decision', title: 'How should we choose between a safe and a promising opportunity?', purpose: 'Compare risk, return, time, and the criteria that make a choice suitable.', question: 'Daily challenge: How do we balance safety and opportunity?' },
    { kind: 'experience', title: 'How did you overcome the hardest beginning of a project?', purpose: 'Share your first steps, obstacles, and what genuinely helped.', question: 'Daily challenge: Share a lesson from a difficult beginning.' },
    { kind: 'knowledge', title: 'How can we organize time without burning out?', purpose: 'Collect practical methods and real examples rather than generic advice.', question: 'Daily challenge: How can we organize time sustainably?' },
    { kind: 'decision', title: 'Should we specialize deeply or build several skills?', purpose: 'Discuss when specialization wins and when combining skills creates value.', question: 'Daily challenge: Deep specialization or a wider skill set?' },
    { kind: 'experience', title: 'What small habit made a meaningful difference?', purpose: 'Explain the habit, how you started, how you sustained it, and the result.', question: 'Daily challenge: A small habit with a big impact.' },
    { kind: 'knowledge', title: 'How do we verify a claim before sharing it?', purpose: 'Suggest checks, sources, and questions that reveal misleading information.', question: 'Daily challenge: Verify before you share.' },
  ],
  fr: [
    { kind: 'knowledge', title: 'Quelle compétence apprendre ce mois-ci ?', purpose: 'Partagez des ressources et des étapes concrètes pour débuter en une semaine.', question: 'Défi du jour : quelle compétence apprendre ce mois-ci ?' },
    { kind: 'decision', title: 'Comment choisir entre sécurité et opportunité ?', purpose: 'Comparez les risques, les bénéfices, le temps et les critères de décision.', question: 'Défi du jour : équilibrer sécurité et opportunité.' },
    { kind: 'experience', title: 'Comment avez-vous surmonté le début difficile d’un projet ?', purpose: 'Partagez les premières étapes, les obstacles et ce qui vous a réellement aidé.', question: 'Défi du jour : une leçon d’un début difficile.' },
    { kind: 'knowledge', title: 'Comment organiser son temps sans épuisement ?', purpose: 'Rassemblez des méthodes pratiques et des exemples réels.', question: 'Défi du jour : mieux organiser son temps.' },
    { kind: 'decision', title: 'Faut-il se spécialiser ou développer plusieurs compétences ?', purpose: 'Discutez des avantages de chaque approche selon le contexte.', question: 'Défi du jour : spécialisation ou polyvalence ?' },
    { kind: 'experience', title: 'Quelle petite habitude a changé beaucoup de choses ?', purpose: 'Décrivez cette habitude, son adoption et les résultats observés.', question: 'Défi du jour : une petite habitude, un grand effet.' },
    { kind: 'knowledge', title: 'Comment vérifier une information avant de la partager ?', purpose: 'Proposez des vérifications et des sources fiables pour éviter la désinformation.', question: 'Défi du jour : vérifier avant de partager.' },
  ],
}

function dayNumber(now: Date) {
  return Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86_400_000)
}

export function getDailyPrompt(locale: Locale, now = new Date()): SessionPrompt {
  const prompts = DAILY_PROMPTS[locale] || DAILY_PROMPTS.ar
  return prompts[dayNumber(now) % prompts.length]
}
