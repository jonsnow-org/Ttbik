// Perks of holding Athar tokens in our bots. Off the chain (nothing here touches the contracts) and read from ownership only, so the
// rules can change at any time. A bot asks /api/perks?address=<wallet> (after it has verified that the user owns that wallet).
export type Perk = { id: string; ar: string; en: string };
export const PERKS: (Perk & { need: (h: { count: number; rare: number; mythic: number }) => boolean })[] = [
  { id: "holder", ar: "شارة «حامل أثر» في الملف الشخصي", en: "“Athar holder” badge on the profile", need: (h) => h.count >= 1 },
  { id: "priority", ar: "أولوية في طابور التحميل وحدود أعلى للتحميل اليومي", en: "Priority in the download queue and higher daily limits", need: (h) => h.count >= 1 },
  { id: "silent", ar: "إيقاف إشعارات البوت مجاناً", en: "Stop bot notifications for free", need: (h) => h.count >= 2 },
  { id: "early", ar: "أولوية الدخول إلى المواسم القادمة", en: "Early access to coming seasons", need: (h) => h.rare + h.mythic >= 1 },
  { id: "gold", ar: "شارة ذهبية ومقعد في قرارات المجتمع", en: "Gold badge and a seat in community decisions", need: (h) => h.mythic >= 1 },
];
export function perksFor(h: { count: number; rare: number; mythic: number }) { return PERKS.filter((p) => p.need(h)).map(({ id, ar, en }) => ({ id, ar, en })); }
