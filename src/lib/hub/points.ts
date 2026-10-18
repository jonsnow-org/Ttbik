// Creator hub points & rewards (/create). Pure math here; storage in hubDb.ts (tables hub_points / hub_points_log).
// Separate from PlatformPoints (bot-to-bot ledger) on purpose: web visitors have no Telegram id. Nothing here touches that ledger.

export const POINT_RULES = {
  daily: 5,          // first visit of the day
  tool_use: 2,       // any hub tool answer
  app_create: 10,
  app_update: 1,
  mood_log: 3,
  doc_draft: 3,
} as const;
export type PointAction = keyof typeof POINT_RULES;

export const DAILY_CAP = 60;           // max points earned per user per UTC day
export const WELCOME_POINTS = 20;      // new users start with enough for one Human Chat credit
export const BASHAR_CREDIT_COST = 10;  // points -> one «بشر» credit

export const LEVELS: { min: number; name: string }[] = [
  { min: 0, name: "مبتدئ" },
  { min: 50, name: "صانع" },
  { min: 150, name: "مبدع" },
  { min: 400, name: "خبير" },
  { min: 1000, name: "أسطورة شام" },
];

/** How many points this action actually adds, given what was already earned today. Never negative, never over the daily cap. */
export function pointsToAward(action: PointAction, earnedToday: number): number {
  const base = POINT_RULES[action] ?? 0;
  const room = Math.max(0, DAILY_CAP - Math.max(0, earnedToday));
  return Math.min(base, room);
}

export function levelFor(total: number): { level: number; name: string; next: number | null; progress: number } {
  const t = Math.max(0, Math.floor(total || 0));
  let i = 0;
  for (let k = 0; k < LEVELS.length; k++) if (t >= LEVELS[k].min) i = k;
  const next = i + 1 < LEVELS.length ? LEVELS[i + 1].min : null;
  const progress = next == null ? 100 : Math.floor(((t - LEVELS[i].min) / (next - LEVELS[i].min)) * 100);
  return { level: i + 1, name: LEVELS[i].name, next, progress };
}

export type ActivityCounts = Partial<Record<PointAction, number>>;
export function badgesFor(total: number, c: ActivityCounts): string[] {
  const b: string[] = [];
  if ((c.app_create ?? 0) >= 1) b.push("🧱 أول تطبيق");
  if ((c.tool_use ?? 0) >= 10) b.push("🛠 مستخدم نشط");
  if ((c.mood_log ?? 0) >= 7) b.push("🌿 أسبوع اهتمام بالنفس");
  if ((c.doc_draft ?? 0) >= 1) b.push("📄 أول مستند");
  if ((c.daily ?? 0) >= 7) b.push("📅 حضور 7 أيام");
  if (total >= 400) b.push("⭐ خبير");
  return b;
}

/** Can this balance buy one Human Chat credit? */
export function canRedeemBashar(balance: number): boolean {
  return balance >= BASHAR_CREDIT_COST;
}
