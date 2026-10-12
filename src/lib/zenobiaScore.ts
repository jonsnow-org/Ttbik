import crypto from "crypto";

/**
 * Zenobia (ZNB) season scoring — pure functions, no network, no database.
 * One Telegram identity = one person (wallets are summed before this runs), so a concave
 * (square-root) transform is safe: splitting a balance across wallets no longer helps.
 * Scores are ranks and titles only — never a promise of any reward.
 */

export const PARAMS = {
  weights: { hold: 0.3, trade: 0.4, accum: 0.3 },
  tradeCapMult: 3, // counted volume is capped at 3x the average balance (wash-trading guard)
  sellFree: 0.25, // selling up to 25% of the opening balance costs nothing
  sellFloor: 0.2, // selling more lowers the score proportionally, never below 20% of it
  transform: "sqrt",
} as const;

export interface PersonSeason {
  id: string; // Telegram user id (as string)
  avgBal: number; // time-weighted average balance over the season, in whole tokens
  volume: number; // tokens bought + sold during the season
  accum: number; // net balance change over the season (may be negative)
  startBal: number; // balance at season start
  sold: number; // tokens sold during the season
}

export interface PersonScore {
  id: string;
  score: number;
  parts: { hold: number; trade: number; accum: number; factor: number };
}

const r8 = (n: number) => Math.round(n * 1e8) / 1e8;
const share = (x: number, total: number) => (total > 0 ? x / total : 0);

export function computeSeason(people: PersonSeason[]): PersonScore[] {
  const t = people.map((p) => ({
    id: p.id,
    hold: Math.sqrt(Math.max(0, p.avgBal)),
    trade: Math.sqrt(Math.max(0, Math.min(p.volume, PARAMS.tradeCapMult * Math.max(0, p.avgBal)))),
    accum: Math.sqrt(Math.max(0, p.accum)),
    soldFrac: p.startBal > 0 ? p.sold / p.startBal : 0,
  }));
  const sum = (k: "hold" | "trade" | "accum") => t.reduce((a, x) => a + x[k], 0);
  const [sh, st, sa] = [sum("hold"), sum("trade"), sum("accum")];
  const w = PARAMS.weights;
  return t
    .map((x) => {
      const hold = share(x.hold, sh);
      const trade = share(x.trade, st);
      const accum = share(x.accum, sa);
      const factor = Math.max(PARAMS.sellFloor, 1 - Math.max(0, x.soldFrac - PARAMS.sellFree));
      const score = r8((w.hold * hold + w.trade * trade + w.accum * accum) * factor);
      return { id: x.id, score, parts: { hold: r8(hold), trade: r8(trade), accum: r8(accum), factor: r8(factor) } };
    })
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
}

export const TITLES = [
  { min: 0.99, en: "Queen's Guard", ar: "حرس الملكة" },
  { min: 0.9, en: "Caravan Leader", ar: "قائد قافلة" },
  { min: 0.6, en: "Master Trader", ar: "تاجر كبير" },
  { min: 0.25, en: "Trader", ar: "تاجر" },
  { min: 0, en: "Bedouin", ar: "بدوي" },
] as const;

/** Title from the rank percentile (0 = last, 1 = first) among scored people. */
export function titleFor(rank: number, total: number) {
  const pct = total <= 1 ? 1 : 1 - (rank - 1) / (total - 1);
  return TITLES.find((t) => pct >= t.min) ?? TITLES[TITLES.length - 1];
}

export type Stage = "child" | "queen" | "warrior" | "captive" | "legend";

/** Zenobia's Journey: the passport follows her life with its holder's journey. Day limits are defaults. */
export function lifeStage(days: number, state: { soldAll?: boolean; burned?: boolean } = {}): Stage {
  if (state.burned) return "legend";
  if (state.soldAll) return "captive";
  if (days < 7) return "child";
  if (days < 21) return "queen";
  return "warrior";
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return "{" + Object.keys(o).sort().map((k) => JSON.stringify(k) + ":" + canonical(o[k])).join(",") + "}";
  }
  return JSON.stringify(v);
}

/** SHA-256 over the canonical season record — what gets published in the weekly ledger transaction. */
export function seasonHash(seasonId: string, results: PersonScore[]): string {
  const body = canonical({ v: 1, season: seasonId, params: PARAMS, results: results.map((r) => [r.id, r.score]) });
  return crypto.createHash("sha256").update(body).digest("hex");
}

/**
 * The living seal: an SVG of Palmyra's colonnade derived only from the season hash.
 * Anyone who recomputes the scores gets the same bytes; change one character and the picture changes.
 */
export function sealSvg(hashHex: string): string {
  const b = Buffer.from(hashHex.padEnd(64, "0").slice(0, 64), "hex");
  const hue = 24 + (b[0] % 24); // warm gold/orange sky
  const cols = 12;
  let columns = "";
  for (let i = 0; i < cols; i++) {
    const h = 150 + (b[1 + i] % 170);
    const x = 90 + i * 70;
    const arch = b[14 + i] % 3 === 0;
    columns += `<rect x="${x}" y="${760 - h}" width="26" height="${h}" fill="#d9b25f"/>` +
      `<rect x="${x - 6}" y="${760 - h - 12}" width="38" height="12" fill="#f0d27a"/>` +
      (arch ? `<path d="M${x + 26} ${760 - h} q22 -46 44 0" fill="none" stroke="#f0d27a" stroke-width="8"/>` : "");
  }
  let stars = "";
  for (let i = 0; i < 24; i++) {
    stars += `<circle cx="${(b[26 + (i % 6)] * (i + 3)) % 1000}" cy="${(b[32 + (i % 8)] * (i + 5)) % 420}" r="${1 + (b[40 + (i % 10)] % 3)}" fill="#fff6d6" opacity="0.8"/>`;
  }
  const sunX = 200 + (b[50] % 600);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="1000" height="1000">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue},55%,18%)"/><stop offset="1" stop-color="hsl(${hue + 8},85%,55%)"/></linearGradient></defs>` +
    `<rect width="1000" height="1000" fill="url(#g)"/>${stars}` +
    `<circle cx="${sunX}" cy="520" r="${70 + (b[51] % 40)}" fill="#ffe7a3" opacity="0.9"/>` +
    `${columns}<rect x="60" y="760" width="880" height="14" fill="#8a6a2d"/>` +
    `<rect x="0" y="774" width="1000" height="226" fill="#2a1b0b"/>` +
    `<text x="500" y="940" text-anchor="middle" font-family="monospace" font-size="22" fill="#d9b25f">${hashHex.slice(0, 16)}…${hashHex.slice(-8)}</text></svg>`;
}
