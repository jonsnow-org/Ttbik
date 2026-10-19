// What brings people back to the coin platform: reactions on a coin, alerts sent by the platform bot, and invite tracking.
// None of it moves money. Alerts are opt-in per coin and per Telegram user; invites are only counted here (no payout).
import crypto from "crypto";
import { Address } from "@ton/core";
import { Bot as TelegramBot, InlineKeyboard } from "grammy";
import { prisma } from "@/lib/prisma";
import { HOSTING } from "@/lib/hostingOps";
import { verifyTelegramInitData } from "@/lib/verifyTelegramOwner";
import { ensureIndexTables, type Snapshot, type IndexedCoin } from "@/lib/znbtIndex";

export const REACTIONS = ["star", "fire", "broken"] as const;
export type Reaction = (typeof REACTIONS)[number];
export const isReaction = (x: unknown): x is Reaction => typeof x === "string" && (REACTIONS as readonly string[]).includes(x);

export const ALERT_KINDS = ["near", "grad", "move"] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];
export const isAlertKind = (x: unknown): x is AlertKind => typeof x === "string" && (ALERT_KINDS as readonly string[]).includes(x);
export const MAX_ALERTS_PER_USER = 20;
export const NEAR_PCT = 90;       // "near graduation" alert
export const MOVE_RATIO = 0.2;    // price moved by this much since the alert was set (or last fired)

let ready: Promise<void> | null = null;
export function ensureEngageTables(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await ensureIndexTables();
      await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS znbt_reactions (curve TEXT NOT NULL, kind TEXT NOT NULL, voter TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (curve, kind, voter))`);
      await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS znbt_alerts (tg_id TEXT NOT NULL, curve TEXT NOT NULL, kind TEXT NOT NULL, lang TEXT NOT NULL DEFAULT 'en', base_tpt TEXT, fired_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (tg_id, curve, kind))`);
      await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS znbt_referrals (invitee TEXT PRIMARY KEY, inviter TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS znbt_referrals_inviter ON znbt_referrals(inviter)`);
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

/** The bot the mini app is opened from: its token verifies Telegram's initData and sends the alerts. */
export async function platformToken(): Promise<string> {
  const row = await prisma.bot.findFirst({ where: { template: "ZNBT_PLATFORM_BOT", isActive: true }, select: { token: true } }).catch(() => null);
  return row?.token || "";
}
export async function tgUserFromInit(initData: string): Promise<string | null> {
  const token = await platformToken();
  return verifyTelegramInitData(initData, token)?.id ?? null;
}

export const ipVoter = (ip: string) => "ip:" + crypto.createHash("sha256").update("znbt-react:" + ip).digest("hex").slice(0, 24);

export async function reactionCounts(curve: string): Promise<Record<Reaction, number>> {
  await ensureEngageTables();
  const rows = (await prisma.$queryRawUnsafe(`SELECT kind, COUNT(*)::int AS n FROM znbt_reactions WHERE curve=$1 GROUP BY kind`, curve)) as { kind: string; n: number }[];
  const out: Record<Reaction, number> = { star: 0, fire: 0, broken: 0 };
  for (const r of rows) if (isReaction(r.kind)) out[r.kind] = r.n;
  return out;
}

export const priceRatio = (baseTpt: string, nowTpt: string): number | null => {
  try {
    const b = BigInt(baseTpt), n = BigInt(nowTpt);
    if (b <= 0n || n <= 0n) return null;
    return Number(b) / Number(n);   // price = 1 / tokens-per-TON, so price_now / price_base = base_tpt / now_tpt
  } catch { return null; }
};
export const progressPct = (c: IndexedCoin): number | null =>
  c.raisedNano && c.thresholdNano && BigInt(c.thresholdNano) > 0n ? Number((BigInt(c.raisedNano) * 10000n) / BigInt(c.thresholdNano)) / 100 : null;

type Lang = "en" | "ru" | "ar";
const L = (x: unknown): Lang => (x === "ru" || x === "ar" ? x : "en");
const T = {
  near: { en: (n: string, p: number) => `${n} is ${p.toFixed(0)}% of the way to graduation.`, ru: (n: string, p: number) => `${n}: ${p.toFixed(0)}% пути до выпуска на DEX.`, ar: (n: string, p: number) => `${n} وصلت إلى ${p.toFixed(0)}% من طريق التخرج.` },
  grad: { en: (n: string) => `${n} has graduated to DeDust.`, ru: (n: string) => `${n} вышла на DeDust.`, ar: (n: string) => `${n} تخرّجت إلى DeDust.` },
  move: { en: (n: string, r: number) => `${n}: price ${r >= 0 ? "up" : "down"} ${Math.abs(r * 100).toFixed(0)}% since your alert.`, ru: (n: string, r: number) => `${n}: цена ${r >= 0 ? "выросла" : "упала"} на ${Math.abs(r * 100).toFixed(0)}% с момента вашего оповещения.`, ar: (n: string, r: number) => `${n}: السعر ${r >= 0 ? "ارتفع" : "انخفض"} ${Math.abs(r * 100).toFixed(0)}% منذ ضبط التنبيه.` },
  foot: { en: "Not financial advice.", ru: "Не финансовая рекомендация.", ar: "ليست نصيحة مالية." },
  open: { en: "Open coin", ru: "Открыть монету", ar: "افتح العملة" },
};

type AlertRow = { tg_id: string; curve: string; kind: string; lang: string; base_tpt: string | null };

/** Called after every index refresh: sends the alerts that are due (at most 5 messages per user per run). Returns how many were sent. */
export async function runAlerts(snap: Snapshot): Promise<number> {
  await ensureEngageTables();
  const rows = (await prisma.$queryRawUnsafe(`SELECT tg_id, curve, kind, lang, base_tpt FROM znbt_alerts WHERE kind='move' OR fired_at IS NULL`)) as AlertRow[];
  if (!rows.length) return 0;
  const token = await platformToken();
  if (!token) return 0;
  const bot = new TelegramBot(token);
  const norm = (a: string) => { try { return Address.parse(a).toString({ bounceable: true, urlSafe: true }); } catch { return a; } };
  const byCurve = new Map(snap.coins.map((c) => [norm(c.curve), c]));
  const sent = new Map<string, number>();
  let n = 0;
  for (const a of rows) {
    const c = byCurve.get(a.curve);
    if (!c) continue;
    const lang = L(a.lang);
    const name = c.name || c.symbol || "Coin";
    let text = "";
    let rebase: string | null = null;
    let done = false;
    if (a.kind === "grad" && (c.state ?? 1) >= 2) { text = T.grad[lang](name); done = true; }
    else if (a.kind === "near") { const p = progressPct(c); if (p !== null && p >= NEAR_PCT && (c.state ?? 1) < 2) { text = T.near[lang](name, p); done = true; } }
    else if (a.kind === "move" && a.base_tpt && c.tokensPerTon) {
      const r = priceRatio(a.base_tpt, c.tokensPerTon);
      if (r !== null && Math.abs(r - 1) >= MOVE_RATIO) { text = T.move[lang](name, r - 1); rebase = c.tokensPerTon; }
    }
    if (!text) continue;
    if ((sent.get(a.tg_id) || 0) >= 5) continue;
    try {
      const url = `${HOSTING.gateUrl}/zenobia/trade.html?c=${encodeURIComponent(a.curve)}${lang === "en" ? "" : `&lang=${lang}`}`;
      await bot.api.sendMessage(a.tg_id, `🔔 ${text}\n${T.foot[lang]}`, { reply_markup: new InlineKeyboard().webApp(`🪙 ${T.open[lang]}`, url) });
      sent.set(a.tg_id, (sent.get(a.tg_id) || 0) + 1);
      n++;
      if (done) await prisma.$executeRawUnsafe(`UPDATE znbt_alerts SET fired_at=now() WHERE tg_id=$1 AND curve=$2 AND kind=$3`, a.tg_id, a.curve, a.kind);
      else if (rebase) await prisma.$executeRawUnsafe(`UPDATE znbt_alerts SET base_tpt=$4, fired_at=now() WHERE tg_id=$1 AND curve=$2 AND kind=$3`, a.tg_id, a.curve, a.kind, rebase);
    } catch (e: any) {
      // the user blocked the bot: drop their alerts so they are not retried forever
      if (/403|blocked|deactivated|chat not found/i.test(String(e?.message || e))) await prisma.$executeRawUnsafe(`DELETE FROM znbt_alerts WHERE tg_id=$1`, a.tg_id).catch(() => null);
    }
  }
  return n;
}

export async function recordReferral(invitee: string, inviter: string): Promise<boolean> {
  if (!/^\d{3,15}$/.test(invitee) || !/^\d{3,15}$/.test(inviter) || invitee === inviter) return false;
  await ensureEngageTables();
  const n = await prisma.$executeRawUnsafe(`INSERT INTO znbt_referrals (invitee, inviter) VALUES ($1,$2) ON CONFLICT DO NOTHING`, invitee, inviter);
  return Number(n) > 0;
}
export async function invitedCount(inviter: string): Promise<number> {
  await ensureEngageTables();
  const rows = (await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM znbt_referrals WHERE inviter=$1`, inviter)) as { n: number }[];
  return rows[0]?.n ?? 0;
}
