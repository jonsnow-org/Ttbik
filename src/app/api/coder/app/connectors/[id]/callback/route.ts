// OAuth callback of every ready-made connector (src/lib/coderConnectors.ts): verifies the signed state, exchanges the code (PKCE
// where supported), stores the token encrypted for that Telegram user, tells them in the chat, and shows a small "back to Telegram" page.
import { NextRequest } from "next/server";
import { Bot } from "grammy";
import { prisma } from "@/lib/prisma";
import { ConnectorError, connectorById, finishConnector } from "@/lib/coderConnectors";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);
const page = (title: string, text: string, ok: boolean, back: string) =>
  new Response(
    `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>` +
      `<body style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#0b1020;color:#e8ecf7;display:grid;place-items:center;min-height:100vh;margin:0">` +
      `<main style="max-width:420px;padding:28px;text-align:center"><div style="font-size:52px">${ok ? "✅" : "⚠️"}</div><h1 style="font-size:20px;margin:12px 0">${esc(title)}</h1>` +
      `<p style="opacity:.8;line-height:1.8">${esc(text)}</p>` +
      (back ? `<a href="${esc(back)}" style="display:inline-block;margin-top:16px;padding:12px 22px;border-radius:12px;background:#2aabee;color:#fff;text-decoration:none;font-weight:700">الرجوع إلى تيليجرام</a>` : "") +
      `</main></body></html>`,
    { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } },
  );

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const d = connectorById(id);
  const code = req.nextUrl.searchParams.get("code") || "";
  const state = req.nextUrl.searchParams.get("state") || "";
  const denied = req.nextUrl.searchParams.get("error");
  const botRow = await prisma.bot.findFirst({ where: process.env.CODER_BOT_ID ? { id: process.env.CODER_BOT_ID } : { template: "NOVA_BOT", isActive: true } }).catch(() => null);
  const bot = botRow ? new Bot(botRow.token) : null;
  const me = bot ? await bot.api.getMe().catch(() => null) : null;
  const back = me?.username ? `https://t.me/${me.username}` : "";
  if (!d) return page("موصل غير معروف", "افتح التطبيق وحاول من جديد.", false, back);
  if (denied) return page("لم يتم الربط", `ألغيت الموافقة على ربط ${d.name}. يمكنك المحاولة متى شئت من التطبيق.`, false, back);
  try {
    const { chatId, label } = await finishConnector(id, code, state);
    if (bot) await bot.api.sendMessage(chatId, `🔌 تم ربط ${d.name}${label ? ` (${label})` : ""}. أقدر أستخدمه الآن في مهامك، وتقدر تفصله متى شئت من «الموصلات».`).catch(() => null);
    return page(`تم ربط ${d.name}`, `${label ? `الحساب ${label} ` : ""}مربوط الآن. ارجع إلى تيليجرام وكمّل.`, true, back);
  } catch (e) {
    return page("تعذّر الربط", e instanceof ConnectorError ? e.message : "حدث خطأ؛ حاول مجدداً من التطبيق.", false, back);
  }
}
