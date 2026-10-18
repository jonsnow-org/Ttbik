// One-time announcements to the two promotion channels, written here (fixed wording, English first, no promise of any return) and sent once each.
// Called by .github/workflows/announce.yml through /api/cron/announce; every id and channel is posted at most once.
import { supabaseAdmin } from "@/lib/supabase";
import { channelBotToken, isSafeForChannel } from "@/lib/channelPublisher";
import { posterToken } from "@/lib/coinsChannel";
import { HOSTING } from "@/lib/hostingOps";

type Where = "general" | "coins";
type Announcement = { text: Record<Where, string>; preview: string; buttons: { text: string; url: string }[] };

const G = () => HOSTING.gateUrl;
const BOT = "https://t.me/PalmyraLaunchBot";

export const ANNOUNCEMENTS: Record<string, () => Announcement> = {
  "znbt-launch": () => {
    const en = `🪙 Zenobia of Tadmor (ZNBt) is live on TON.\nA coin that remembers your journey: hold it and grow from Child to Queen to Warrior; sell everything and you become a Captive; burn it and you become a Legend.\nFees: 1.5% platform + 1.5% creator. Experimental, unaudited contracts: you can lose everything you put in. Not financial advice.`;
    const ar = `🪙 زنوبيا التدمرية (ZNBt) على شبكة TON.\nعملة تتذكّر رحلتك: احتفظ بها لتنمو من طفل إلى ملكة إلى محارب؛ بع كل شيء فتصير أسيراً؛ احرقها فتصير أسطورة.\nالرسوم 1.5% للمنصة + 1.5% للمُطلِق. العقود تجريبية وغير مدقَّقة وقد تخسر كل ما تضعه. ليست نصيحة مالية.`;
    const terms = `Terms and risks: ${G()}/zenobia/terms.html`;
    return {
      text: { general: `${en}\n\n${ar}\n\n${terms}`, coins: `${en}\n\n${terms}` },
      preview: `${G()}/zenobia/trade.html`,
      buttons: [{ text: "🪙 ZNBt", url: `${G()}/zenobia/trade.html` }, { text: "🤖 Palmyra Launch", url: BOT }],
    };
  },
};

const STATE_KEY = "announce_done";
async function done(): Promise<Record<string, string>> {
  try { const { data } = await supabaseAdmin().from("bot_settings").select("value").eq("key", STATE_KEY).maybeSingle(); return ((data as { value?: Record<string, string> } | null)?.value) ?? {}; } catch { return {}; }
}

export async function announce(id: string, to: Where | "both", dry = false): Promise<Record<string, string>> {
  const make = ANNOUNCEMENTS[id];
  if (!make) return { error: "unknown-id" };
  const a = make();
  const state = await done();
  const out: Record<string, string> = {};
  for (const where of (to === "both" ? ["general", "coins"] : [to]) as Where[]) {
    const key = `${id}:${where}`;
    if (state[key]) { out[where] = "already-sent"; continue; }
    const text = a.text[where];
    if (!isSafeForChannel(text)) { out[where] = "blocked-by-filter"; continue; }
    if (dry) { out[where] = "dry-run"; continue; }
    const token = where === "coins" ? (await posterToken()) || (await channelBotToken()) : await channelBotToken();
    const chat = where === "coins" ? process.env.TELEGRAM_COINS_CHANNEL_ID || "@Zenobiaton" : process.env.TELEGRAM_CHANNEL_ID || "@ttbik5";
    if (!token) { out[where] = "no-bot-token"; continue; }
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, reply_markup: { inline_keyboard: [a.buttons] }, link_preview_options: { url: a.preview, prefer_large_media: true } }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => null) : null;
    if (data?.ok === true) {
      state[key] = new Date().toISOString();
      await supabaseAdmin().from("bot_settings").upsert({ key: STATE_KEY, value: state, updated_at: new Date().toISOString() });
      out[where] = "sent";
    } else out[where] = `telegram: ${String(data?.description || "request-failed").slice(0, 120)}`;
  }
  return out;
}
