// The kinds of Athar token, and how a token id is made from a date and a kind. Mirrors contracts/messages.tact.
//   id = kind * 65536 + date   (kind 0, the normal token, has id = date: its address and links are what they always were)
// Direct kinds (normal, silver, gold) are bought by anyone. Classes (bronze, rare, purple, diamond, legendary) are minted by the owner and
// sold by auction or in mystery boxes. The same date can exist once in every kind.
export const ID_SHIFT = 65536;
export const KIND_COUNT = 8;
export const DIRECT_KINDS = [0, 1, 2] as const;
export const CLASS_KINDS = [3, 4, 5, 6, 7] as const;

export type KindKey = "normal" | "silver" | "gold" | "bronze" | "rare" | "purple" | "diamond" | "legendary";
export const KINDS: { id: number; key: KindKey; en: string; ar: string; direct: boolean }[] = [
  { id: 0, key: "normal", en: "Normal", ar: "عادي", direct: true },
  { id: 1, key: "silver", en: "Silver", ar: "فضي", direct: true },
  { id: 2, key: "gold", en: "Gold", ar: "ذهبي", direct: true },
  { id: 3, key: "bronze", en: "Bronze", ar: "برونزي", direct: false },
  { id: 4, key: "rare", en: "Rare", ar: "نادر", direct: false },
  { id: 5, key: "purple", en: "Purple", ar: "أرجواني", direct: false },
  { id: 6, key: "diamond", en: "Diamond", ar: "ألماسي", direct: false },
  { id: 7, key: "legendary", en: "Legendary", ar: "أسطوري", direct: false },
];
export const KIND_NAME_EN = KINDS.map((k) => k.en);
export const KIND_NAME_AR = KINDS.map((k) => k.ar);

export const idOf = (kind: number, date: number) => kind * ID_SHIFT + date;
export const kindOf = (id: number) => Math.floor(id / ID_SHIFT);
export const dateOf = (id: number) => id % ID_SHIFT;
export const isDirect = (kind: number) => kind >= 0 && kind <= 2;
/** Is this a token id the collection can hold (a kind 0..7 and a date 0..36524)? */
export const validId = (id: number, totalDates = 36525) => Number.isInteger(id) && id >= 0 && kindOf(id) < KIND_COUNT && dateOf(id) < totalDates;

/** How a kind looks. `density` is how rich the guilloche rosette is (0 plain, 1 fine rays, 2 golden halo and many rays), `crystal` draws the
 *  crystal bloom instead of the rosette, `gold` gives the gold rim and halo, `petals` sets a crystal's petals; `shine` adds a passing glint. */
export type KindLook = {
  pal: { bg1: string; bg2: string; ink: string; accent: string } | null;   // null: the season's own palette (the normal kind)
  accent: string;                                                            // rim and line colour
  lineA: string; lineB: string;                                              // colours of the rosette's lines (dim backgrounds)
  disc: string;                                                              // fill of the centre disc
  density: 0 | 1 | 2;
  crystal: boolean; gold: boolean; petals?: number; shine: boolean; stroke: number; coreOp: number;
  label: string;                                                             // printed on the token
};
export const LOOK: KindLook[] = [
  { pal: null, accent: "#9dbbff", lineA: "#ffffff", lineB: "#c4d7ff", disc: "#0a1633", density: 0, crystal: false, gold: false, shine: false, stroke: 4, coreOp: 0.55, label: "NORMAL" },
  { pal: { bg1: "#10131c", bg2: "#3a4256", ink: "#f4f7ff", accent: "#d5dcec" }, accent: "#d5dcec", lineA: "#ffffff", lineB: "#aeb8d0", disc: "#0d1119", density: 1, crystal: false, gold: false, shine: true, stroke: 5, coreOp: 0.5, label: "SILVER" },
  { pal: { bg1: "#1c1304", bg2: "#5a4010", ink: "#fff6d6", accent: "#ffd36a" }, accent: "#ffd36a", lineA: "#fff6d6", lineB: "#ffd25a", disc: "#2a1c06", density: 2, crystal: false, gold: true, shine: true, stroke: 9, coreOp: 0.55, label: "GOLD" },
  { pal: { bg1: "#1d0e05", bg2: "#6b3513", ink: "#ffe9d6", accent: "#e08a4a" }, accent: "#e08a4a", lineA: "#ffd9bd", lineB: "#d9863f", disc: "#241006", density: 1, crystal: false, gold: false, shine: false, stroke: 7, coreOp: 0.5, label: "BRONZE" },
  { pal: { bg1: "#04201f", bg2: "#0f5a55", ink: "#eafffa", accent: "#5ff0cf" }, accent: "#5ff0cf", lineA: "#ffffff", lineB: "#c4d7ff", disc: "#04201f", density: 1, crystal: true, gold: false, petals: 12, shine: true, stroke: 6, coreOp: 0.26, label: "RARE" },
  { pal: { bg1: "#14052a", bg2: "#4b1a8c", ink: "#f6eaff", accent: "#c78bff" }, accent: "#c78bff", lineA: "#ffffff", lineB: "#dcc2ff", disc: "#12041f", density: 1, crystal: true, gold: false, petals: 16, shine: true, stroke: 7, coreOp: 0.3, label: "PURPLE" },
  { pal: { bg1: "#07121f", bg2: "#2a5d86", ink: "#ffffff", accent: "#bfe9ff" }, accent: "#bfe9ff", lineA: "#ffffff", lineB: "#d9f2ff", disc: "#06101a", density: 2, crystal: true, gold: false, petals: 14, shine: true, stroke: 7, coreOp: 0.34, label: "DIAMOND" },
  { pal: { bg1: "#241003", bg2: "#7a4a0c", ink: "#fff3cf", accent: "#ffe07a" }, accent: "#ffe07a", lineA: "#fff9e0", lineB: "#ffe07a", disc: "#2f1d05", density: 2, crystal: false, gold: true, shine: true, stroke: 11, coreOp: 0.6, label: "LEGENDARY" },
];
export const lookOf = (kind: number): KindLook => LOOK[kind] ?? LOOK[0];
