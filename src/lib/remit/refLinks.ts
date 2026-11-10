// The owner's referral links for /remit, settable from Telegram without a redeploy: the owner's command in the site bot
//   /ref                     list every provider key and its current link
//   /ref CHANGENOW https://… set (https only)
//   /ref CHANGENOW off       back to the official site
//   /ref CHANGENOW 123040aec1d261   a bare ChangeNOW partner id is turned into https://changenow.io/?link_id=…
//   /ref STEALTHEX <widget-id>      a bare StealthEX id is the embed id (stored as STEALTHEX_WIDGET)
// Stored in its own table (created on first use). Env REMIT_REF_<KEY> still works as a fallback.
import { prisma } from "@/lib/prisma";
import { PROVIDERS } from "@/lib/remit/remit";
import { changenowLinkId, stealthexWidgetId } from "@/lib/remit/widgets";

// Extra keys that are not providers: the StealthEX embed id (from its partner profile, Code tab).
const EXTRA_KEYS = ["STEALTHEX_WIDGET", "CHANGENOW_API"];

let ready: Promise<void> | null = null;
function ensure(): Promise<void> {
  if (!ready) ready = prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS remit_ref_links (key TEXT PRIMARY KEY, url TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`).then(() => undefined).catch((e) => { ready = null; throw e; });
  return ready;
}

let cache: { at: number; v: Record<string, string> } | null = null;
export async function savedRefLinks(): Promise<Record<string, string>> {
  if (cache && Date.now() - cache.at < 60_000) return cache.v;
  await ensure();
  const rows = await prisma.$queryRaw<{ key: string; url: string }[]>`SELECT key, url FROM remit_ref_links`;
  const v = Object.fromEntries(rows.map((r) => [r.key, r.url]));
  cache = { at: Date.now(), v };
  return v;
}

export type RefCommand = { kind: "list" } | { kind: "set"; key: string; url: string } | { kind: "clear"; key: string } | { kind: "error"; message: string };
/** Parses "/ref", "/ref KEY URL", "/ref KEY off". Pure. */
export function parseRefCommand(text: string): RefCommand | null {
  const m = /^\/ref(?:@\w+)?(?:\s+(\S+))?(?:\s+(\S+))?\s*$/i.exec(String(text || "").trim());
  if (!m) return null;
  if (!m[1]) return { kind: "list" };
  const key = m[1].toUpperCase();
  if (!PROVIDERS.some((p) => p.key === key) && !EXTRA_KEYS.includes(key)) return { kind: "error", message: `مفتاح غير معروف: ${key}. اكتب /ref لرؤية المفاتيح.` };
  if (!m[2]) return { kind: "error", message: `اكتب: /ref ${key} https://رابطك أو /ref ${key} off` };
  if (/^(off|clear|delete|حذف)$/i.test(m[2])) return { kind: "clear", key };
  if (key === "CHANGENOW_API") return /^[A-Za-z0-9_-]{16,128}$/.test(m[2]) ? { kind: "set", key, url: m[2] } : { kind: "error", message: "مفتاح API غير صالح. انسخه من ChangeNOW: Dashboard › Profile settings › Account details." };
  if (key === "CHANGENOW" && !/^https:/i.test(m[2]) && changenowLinkId(m[2])) return { kind: "set", key, url: `https://changenow.io/?link_id=${m[2]}` };
  if ((key === "STEALTHEX" || key === "STEALTHEX_WIDGET") && !/^https:/i.test(m[2]) && stealthexWidgetId(m[2])) return { kind: "set", key: "STEALTHEX_WIDGET", url: m[2] };
  if (!/^https:\/\/[^\s<>"]{4,400}$/.test(m[2])) return { kind: "error", message: "الرابط يجب أن يبدأ بـ https://" };
  return { kind: "set", key, url: m[2] };
}

/** Runs a parsed command and returns the reply text. */
export async function runRefCommand(cmd: RefCommand): Promise<string> {
  if (cmd.kind === "error") return cmd.message;
  await ensure();
  if (cmd.kind === "set") await prisma.$executeRaw`INSERT INTO remit_ref_links (key, url) VALUES (${cmd.key}, ${cmd.url}) ON CONFLICT (key) DO UPDATE SET url = EXCLUDED.url, updated_at = now()`;
  if (cmd.kind === "clear") await prisma.$executeRaw`DELETE FROM remit_ref_links WHERE key = ${cmd.key}`;
  cache = null;
  const saved = await savedRefLinks();
  if (cmd.kind === "set" && cmd.key === "CHANGENOW") {
    const id = changenowLinkId(cmd.url);
    return id
      ? `✅ ChangeNOW: ودجت التبديل ظهر أعلى صفحة الحوالات برقم الشريك ${id} (خلال دقيقة)، وكل تبديل منه يُحتسب لك.\n${cmd.url}`
      : `⚠️ حفظت الرابط كزر إحالة، لكن لم أجد link_id فيه، فالودجت لن يظهر. أرسل الرابط من ChangeNOW (Profile settings › Referral links) أو الرقم وحده: /ref CHANGENOW 123abc…`;
  }
  if (cmd.kind === "set" && cmd.key === "CHANGENOW_API") return "✅ مكتب الحوالات مفعّل: الإرسال من المحادثة يعمل الآن، وكل حوالة تُنشأ بمفتاحك فتُحتسب عمولتها لحسابك في ChangeNOW. (احذف رسالتك التي فيها المفتاح من المحادثة.)";
  if (cmd.kind === "set" && cmd.key === "STEALTHEX_WIDGET") return `✅ StealthEX: ودجت التبديل يظهر في صفحة الحوالات (إن لم يكن ChangeNOW مضبوطاً) برقم ${cmd.url}.`;
  if (cmd.kind === "set") return `✅ ${cmd.key}: قسم الحوالات يستخدم رابطك الآن (خلال دقيقة).\n${cmd.url}`;
  if (cmd.kind === "clear") return `✅ ${cmd.key}: رجع للموقع الرسمي.`;
  const opens = await remitOpensByBot().catch(() => []);
  const opensLine = opens.length ? ["", "📈 فتح قسم الحوالات (30 يوماً):", ...opens.map((o) => `• ${o.bot_id === "site" ? "الموقع" : `بوت ${o.bot_id}`}: ${o.n}`)] : [];
  return ["🔗 روابط الإحالة في قسم الحوالات", "", ...PROVIDERS.map((p) => `${saved[p.key] || process.env[`REMIT_REF_${p.key}`] ? "✅" : "▫️"} ${p.key} · ${p.name}${saved[p.key] ? `\n   ${saved[p.key]}` : ""}`), "", `${saved.STEALTHEX_WIDGET ? "✅" : "▫️"} STEALTHEX_WIDGET · ودجت StealthEX`, `${saved.CHANGENOW_API || process.env.CHANGENOW_API_KEY ? "✅" : "▫️"} CHANGENOW_API · مكتب الحوالات في المحادثة${saved.CHANGENOW_API ? ` (…${saved.CHANGENOW_API.slice(-4)})` : ""}`, "", "للضبط: /ref CHANGENOW https://… (رابط الإحالة أو link_id وحده يُظهر الودجت)", "للإلغاء: /ref CHANGENOW off", ...opensLine].join("\n");
}

// Opens of the remittance Mini App per bot (`?bot=<Bot.id>` from each bot's button), so the owner sees which bots bring traffic.
// Partner commissions are paid by the exchanger to the owner's partner account, with no per-transaction data back to us, so this is
// the only per-bot signal available.
let opensReady: Promise<void> | null = null;
function ensureOpens(): Promise<void> {
  if (!opensReady) opensReady = prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS remit_opens (day DATE NOT NULL DEFAULT CURRENT_DATE, bot_id TEXT NOT NULL, n INT NOT NULL DEFAULT 0, PRIMARY KEY (day, bot_id))`).then(() => undefined).catch((e) => { opensReady = null; throw e; });
  return opensReady;
}
export async function recordRemitOpen(botId: string | null): Promise<void> {
  await ensureOpens();
  await prisma.$executeRaw`INSERT INTO remit_opens (bot_id, n) VALUES (${botId || "site"}, 1) ON CONFLICT (day, bot_id) DO UPDATE SET n = remit_opens.n + 1`;
}
export async function remitOpensByBot(days = 30): Promise<{ bot_id: string; n: number }[]> {
  await ensureOpens();
  const rows = await prisma.$queryRaw<{ bot_id: string; n: bigint | number }[]>`SELECT bot_id, SUM(n) AS n FROM remit_opens WHERE day > CURRENT_DATE - ${days}::int GROUP BY bot_id ORDER BY 2 DESC LIMIT 10`;
  return rows.map((r) => ({ bot_id: r.bot_id, n: Number(r.n) }));
}
