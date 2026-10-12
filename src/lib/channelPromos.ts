/**
 * The promo rotation for the public Telegram channel. Fixed texts for the owner's own projects (never left to the AI: a wrong link or a
 * profit promise in a public post is the one mistake this must never make), plus the existing pools (free tools, live bots, paid services).
 * The pick is deterministic by day and slot, so every pool and every project comes round regularly instead of by luck.
 */

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/$/, "");
const ATHAR_BOT = (process.env.NEXT_PUBLIC_ATHAR_BOT_URL || "https://t.me/AtharDaysBot").trim();
const ZENOBIA_BUY = "https://t.me/blum/app?startapp=memepadjetton_ZNB_gMTPq-ref_GcJK8kBUGD";
const ZENOBIA_BOT = "https://t.me/Zenobia_Palmyrabot";
const ZENOBIA_CHANNEL = "https://t.me/Zenobiaton";

export type FixedPromo = { id: string; text: string };

export const PROJECT_PROMOS: FixedPromo[] = [
  {
    id: "zenobia-coin",
    text:
      `🏛 Zenobia (ZNB): a community coin inspired by Zenobia, queen of Palmyra, and the Silk Road.\n` +
      `Buy / trade: ${ZENOBIA_BUY}\nChannel: ${ZENOBIA_CHANNEL}\n` +
      `Not financial advice. Crypto is risky; only use what you can afford to lose.\n\n` +
      `🏛 زنوبيا (ZNB): عملة مجتمعية مستوحاة من ملكة تدمر وطريق الحرير.\nالشراء والتداول: ${ZENOBIA_BUY}\nالقناة: ${ZENOBIA_CHANNEL}\n` +
      `ليست نصيحة مالية. العملات الرقمية محفوفة بالمخاطر، ولا تستخدم إلا ما تتحمل خسارته.`,
  },
  {
    id: "zenobia-passport",
    text:
      `🪪 Silk Road Passport · From Palmyra: 2,500 only, grows with its age (Child, Queen, Warrior), locked for 30 days, then free to trade. For ZNB holders.\n${SITE}/zenobia/silk.html\n\n` +
      `🪪 جواز مرور طريق الحرير من تدمر: 2,500 فقط، يكبر بعمره (طفلة ثم ملكة ثم محاربة)، ويُقفل 30 يومًا ثم يُباع ويُشترى بحرية. لحاملي ZNB.\n${SITE}/zenobia/silk.html\n` +
      `ليس وعدًا بأي عائد.`,
  },
  {
    id: "zenobia-board",
    text:
      `🏆 Caravan Board: who has held ZNB the longest. Connect a wallet, no account needed.\n${SITE}/zenobia/hall.html\nBot: ${ZENOBIA_BOT}\n\n` +
      `🏆 لوحة القافلة: من احتفظ بـ ZNB أطول مدة. اربط محفظتك فقط، بلا حساب.\n${SITE}/zenobia/hall.html\nالبوت: ${ZENOBIA_BOT}\nترتيب وألقاب فقط، بلا وعد بمكافأة.`,
  },
  {
    id: "athar-days",
    text:
      `✨ أثر: رمز حيّ لكل يوم من التقويم، صورته تومض وتدور وينضج كلما طال بقاؤه عندك، ويمكنك وضع صورتك عليه وإهداؤه لمن تحب.\n` +
      `ابحث عن تاريخك (يوم ميلاد أو ذكرى) من البوت:\n${ATHAR_BOT}\n` +
      `الرموز للذكرى والاقتناء، ولا وعد بأي عائد أو ارتفاع سعر.`,
  },
  {
    id: "athar-today",
    text:
      `📅 رمز اليوم في أثر: كل يوم تاريخ جديد يمكن أن يصير رمزك. افتح البوت وشاهد رمز اليوم واحجزه إن كان متاحًا.\n${ATHAR_BOT}\n` +
      `للذكرى والاقتناء، ولا وعد بأي عائد.`,
  },
];

export type Topic = { name: string; url: string };

/** Which kind of promo a (day, slot) gets: a repeating cycle that interleaves the owner's projects with the other pools. */
export const CYCLE = ["zenobia-coin", "free", "athar-days", "bot", "zenobia-passport", "service", "athar-today", "bot", "free", "zenobia-board", "service", "athar-days"] as const;

export function dayNumber(d: Date): number {
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000);
}

export function pickPromoKind(d: Date, slot: number): { kind: (typeof CYCLE)[number]; turn: number } {
  const n = dayNumber(d) * 3 + (Math.min(3, Math.max(1, slot)) - 1);
  return { kind: CYCLE[n % CYCLE.length], turn: Math.floor(n / CYCLE.length) };
}

/** The `turn`-th element of a pool, walking it in order (the pool can grow or shrink: the index just wraps). */
export function rotate<T>(pool: T[], turn: number, offset = 0): T | undefined {
  return pool.length ? pool[(turn + offset) % pool.length] : undefined;
}
