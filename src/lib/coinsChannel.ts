// The second promotion channel: Athar, Zenobia (the old coin ZNB and the new ZNBt) and the Palmyra Launch platform.
// The general channel (channelRotation.ts) stays site-wide; this one only carries the owner's own projects.
// The poster is the old Zenobia bot (admin of that channel); the platform bot is the fallback. No hard-coded host: links come from SITE_URL and the gate.
import { prisma } from "@/lib/prisma";
import { supabaseAdmin } from "@/lib/supabase";
import { isSafeForChannel } from "@/lib/channelPublisher";
import { buildPool, formatPost, type PoolItem } from "@/lib/channelPool";
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

export async function publishCoinsChannel(opts: { dry?: boolean } = {}): Promise<CoinsResult> {
  const cfg = await getConfig().catch(() => null);
  const pool = buildPool({ znbt: !!cfg?.curve, platform: !!cfg?.curve && !!cfg?.open });
  const items: PoolItem[] = [...pool.coin, ...pool.project];
  const state = await loadState();
  if (!opts.dry && state.lastPostAt && Date.now() - Date.parse(state.lastPostAt) < MIN_GAP_MS) return { ok: false, reason: "too-soon" };
  const now = Date.now();
  const due = items
    .filter((it) => { const last = Date.parse(state.seenAt[it.id] || "") || 0; return !last || now - last >= it.repeatDays * 86400000; })
    .sort((a, b) => (Date.parse(state.seenAt[a.id] || "") || 0) - (Date.parse(state.seenAt[b.id] || "") || 0));
  const pick = due.find((it) => isSafeForChannel(formatPost(it, state.cursor)));
  if (!pick) return { ok: false, reason: "nothing-due" };
  const text = formatPost(pick, state.cursor);
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
