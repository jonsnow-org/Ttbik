// The owner's referral links for /remit, settable from Telegram without a redeploy: the Admen bot's admin command
//   /ref                     list every provider key and its current link
//   /ref CHANGENOW https://… set (https only)
//   /ref CHANGENOW off       back to the official site
// Stored in its own table (created on first use). Env REMIT_REF_<KEY> still works as a fallback.
import { prisma } from "@/lib/prisma";
import { PROVIDERS } from "@/lib/remit/remit";

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
  if (!PROVIDERS.some((p) => p.key === key)) return { kind: "error", message: `مفتاح غير معروف: ${key}. اكتب /ref لرؤية المفاتيح.` };
  if (!m[2]) return { kind: "error", message: `اكتب: /ref ${key} https://رابطك أو /ref ${key} off` };
  if (/^(off|clear|delete|حذف)$/i.test(m[2])) return { kind: "clear", key };
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
  if (cmd.kind === "set") return `✅ ${cmd.key}: صفحة الحوالات تستخدم رابطك الآن (خلال دقيقة).\n${cmd.url}`;
  if (cmd.kind === "clear") return `✅ ${cmd.key}: رجع للموقع الرسمي.`;
  return ["🔗 روابط الإحالة في صفحة الحوالات", "", ...PROVIDERS.map((p) => `${saved[p.key] || process.env[`REMIT_REF_${p.key}`] ? "✅" : "▫️"} ${p.key} · ${p.name}${saved[p.key] ? `\n   ${saved[p.key]}` : ""}`), "", "للضبط: /ref CHANGENOW https://…", "للإلغاء: /ref CHANGENOW off"].join("\n");
}
