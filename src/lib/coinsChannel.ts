// The second promotion channel: Athar, Zenobia (the old coin ZNB and the new ZNBt) and the Palmyra Launch platform.
// The general channel (channelRotation.ts) stays site-wide; this one only carries the owner's own projects.
// The poster is the old Zenobia bot (admin of that channel); the platform bot is the fallback. No hard-coded host: links come from SITE_URL and the gate.
import { prisma } from "@/lib/prisma";
import { supabaseAdmin } from "@/lib/supabase";
import { isSafeForChannel } from "@/lib/channelPublisher";
import { HOSTING } from "@/lib/hostingOps";
import { getConfig } from "@/lib/znbtConfig";

const STATE_KEY = "coins_channel_state";
const MIN_GAP_MS = 3 * 3600 * 1000;
const channelId = () => process.env.TELEGRAM_COINS_CHANNEL_ID || "@Zenobiaton";

type State = { seenAt: Record<string, string>; lastPostAt: string; cursor: number };

async function loadState(): Promise<State> {
  try {
    const { data } = await supabaseAdmin().from("bot_settings").select("value").eq("key", STATE_KEY).maybeSingle();
    const v = (data as { value?: Partial<State> } | null)?.value || {};
    return { seenAt: v.seenAt && typeof v.seenAt === "object" ? v.seenAt : {}, lastPostAt: typeof v.lastPostAt === "string" ? v.lastPostAt : "", cursor: typeof v.cursor === "number" ? v.cursor : 0 };
  } catch { return { seenAt: {}, lastPostAt: "", cursor: 0 }; }
}
async function saveState(s: State): Promise<void> {
  await supabaseAdmin().from("bot_settings").upsert({ key: STATE_KEY, value: s, updated_at: new Date().toISOString() });
}

export async function posterToken(): Promise<string> {
  for (const template of ["ZENOBIA_BOT", "ZNBT_PLATFORM_BOT"]) {
    const row = await prisma.bot.findFirst({ where: { template, isActive: true }, select: { token: true } }).catch(() => null);
    if (row?.token) return row.token;
  }
  return "";
}

export type CoinsResult = { ok: boolean; reason?: string; topic?: string; text?: string };

// This channel is English only (owner order 2026-10-18): fixed English wording, English buttons and hashtags, no Arabic anywhere.
type Item = { id: string; title: string; text: string; url: string; cta: string; target?: { url: string; label: string }; tags: string; repeatDays: number };
const ZNB_BUY = "https://t.me/blum/app?startapp=memepadjetton_ZNB_gMTPq-ref_GcJK8kBUGD";
const ZNB_CONTRACT = "EQDai9iDv4fDlQHUDxx59QUZMGvTm9uzUL867c_Lxi4cDuCN";
const ZENOBIA_BOT = "https://t.me/Zenobia_Palmyrabot";
const ATHAR_BOT = (process.env.NEXT_PUBLIC_ATHAR_BOT_URL || "https://t.me/AtharDaysBot").trim();
const PLATFORM_BOT = (process.env.NEXT_PUBLIC_PLATFORM_BOT_URL || "https://t.me/PalmyraLaunchBot").trim();
const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function coinsPool(flags: { znbt: boolean; platform: boolean }): Item[] {
  const G = HOSTING.gateUrl;
  const items: Item[] = [
    { id: "znb:intro", title: "Zenobia (ZNB)", text: "A community coin inspired by the queen of Palmyra and the Silk Road. Not financial advice; crypto is risky.", url: `${G}/zenobia/hall.html?lang=en`, cta: "🏆 Caravan board", target: { url: ZNB_BUY, label: "🛒 Buy ZNB" }, tags: "#Zenobia #ZNB #TON", repeatDays: 3 },
    { id: "znb:how-to-buy", title: "How to buy ZNB", text: `Open the coin's page on Blum from the button, connect your wallet, choose the amount and confirm. Check the contract address first: ${ZNB_CONTRACT}. Only use what you can afford to lose.`, url: ZNB_BUY, cta: "🛒 Open on Blum", tags: "#ZNB #TON", repeatDays: 6 },
    { id: "passport", title: "Silk Road Passport from Palmyra", text: "Only 2,500 exist. It grows with its age (child, then queen, then warrior), stays locked for 30 days, then it is free to trade. For holders of ZNB or ZNBt. A keepsake only, with no promise of any return.", url: `${G}/zenobia/silk.html?lang=en`, cta: "🪪 Get your passport", target: { url: ZENOBIA_BOT, label: "🤖 Zenobia bot" }, tags: "#Zenobia #NFT #TON", repeatDays: 4 },
    { id: "board", title: "The Caravan Board", text: "Who held longest? The board shows ranks and titles only, not profit. Join Zenobia's caravan from the bot.", url: `${G}/zenobia/hall.html?lang=en`, cta: "🏆 Open the board", target: { url: ZENOBIA_BOT, label: "🤖 Zenobia bot" }, tags: "#Zenobia #TON", repeatDays: 5 },
    { id: "athar:days", title: "Athar · a living token for every day", text: "Every day of the calendar has one token: your birthday, your anniversary, a day you love. Its picture is alive and matures the longer you hold it. A keepsake on TON, not an investment.", url: ATHAR_BOT, cta: "🕰 Open Athar", tags: "#Athar #TON", repeatDays: 4 },
    { id: "athar:today", title: "Today's token in Athar", text: "A new date every day could become your token. Open Athar, see today's token and claim it if it is free. A keepsake only.", url: ATHAR_BOT, cta: "📅 Today's token", tags: "#Athar #TON", repeatDays: 7 },
  ];
  if (flags.znbt) items.push({ id: "znbt", title: "ZNBt · Zenobia of Tadmor", text: "Zenobia's new coin on TON, launched on our own platform. Hold it and grow from Child to Queen to Warrior. Fees 1.5% platform + 1.5% creator. Experimental, unaudited contracts: you can lose everything you put in. Not financial advice.", url: `${G}/zenobia/trade.html`, cta: "🪙 Open ZNBt", target: { url: PLATFORM_BOT, label: "🤖 Palmyra Launch" }, tags: "#ZNBt #TON", repeatDays: 3 });
  if (flags.platform) items.push({ id: "palmyra-launch", title: "Palmyra Launch", text: "Launch your own coin on TON in a few taps, or browse coins others launched. Fees are fixed and shown before you confirm. Not financial advice; crypto is risky.", url: `${G}/zenobia/coins.html?lang=en`, cta: "🪙 Open Palmyra Launch", target: { url: PLATFORM_BOT, label: "🤖 Palmyra Launch bot" }, tags: "#PalmyraLaunch #TON", repeatDays: 3 });
  return items;
}
const fmtPost = (it: Item) => `<b>${esc(it.title)}</b>\n\n${esc(it.text)}\n\n${it.tags}`;

export async function publishCoinsChannel(opts: { dry?: boolean } = {}): Promise<CoinsResult> {
  const cfg = await getConfig().catch(() => null);
  const items = coinsPool({ znbt: !!cfg?.curve, platform: !!cfg?.curve && !!cfg?.open });
  const state = await loadState();
  if (!opts.dry && state.lastPostAt && Date.now() - Date.parse(state.lastPostAt) < MIN_GAP_MS) return { ok: false, reason: "too-soon" };
  const now = Date.now();
  const due = items
    .filter((it) => { const last = Date.parse(state.seenAt[it.id] || "") || 0; return !last || now - last >= it.repeatDays * 86400000; })
    .sort((a, b) => (Date.parse(state.seenAt[a.id] || "") || 0) - (Date.parse(state.seenAt[b.id] || "") || 0));
  const pick = due.find((it) => isSafeForChannel(fmtPost(it)));
  if (!pick) return { ok: false, reason: "nothing-due" };
  const text = fmtPost(pick);
  if (opts.dry) return { ok: true, topic: pick.title, text, reason: "dry-run" };
  const token = await posterToken();
  if (!token) return { ok: false, reason: "no-bot-token" };
  const rows: { text: string; url: string }[][] = [[{ text: pick.cta, url: pick.url }]];
  if (pick.target) rows.unshift([{ text: pick.target.label, url: pick.target.url }]);
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: channelId(), text: text.slice(0, 4000), parse_mode: "HTML", reply_markup: { inline_keyboard: rows }, link_preview_options: { url: pick.url, prefer_large_media: true, show_above_text: true } }),
  }).catch(() => null);
  const data = res ? await res.json().catch(() => null) : null;
  if (data?.ok !== true) return { ok: false, topic: pick.title, reason: `telegram: ${String(data?.description || "request-failed").slice(0, 160)}` };
  state.seenAt[pick.id] = new Date().toISOString();
  state.lastPostAt = state.seenAt[pick.id];
  state.cursor += 1;
  await saveState(state).catch(() => null);
  return { ok: true, topic: pick.title, text };
}
