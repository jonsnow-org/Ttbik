// GitHub OAuth callback of the coder Mini App: stores the user's own token (encrypted) and tells them in the chat.
import { NextRequest } from "next/server";
import { Bot } from "grammy";
import { prisma } from "@/lib/prisma";
import { AppError, oauthFinish } from "@/lib/coderApp";
import { siteBase } from "@/lib/coderConnectors";

export const dynamic = "force-dynamic";

const page = (title: string, text: string, ok: boolean) =>
  new Response(
    `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>` +
      `<body style="font-family:system-ui,sans-serif;background:#0b1020;color:#e8ecf7;display:grid;place-items:center;min-height:100vh;margin:0"><main style="max-width:420px;padding:28px;text-align:center">` +
      `<div style="font-size:44px">${ok ? "✅" : "⚠️"}</div><h1 style="font-size:20px">${title}</h1><p style="opacity:.8;line-height:1.7">${text}</p></main></body></html>`,
    { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code") || "";
  const state = req.nextUrl.searchParams.get("state") || "";
  const redirect = `${siteBase()}/api/coder/app/github/callback`;           // must equal the redirect_uri of the start leg
  try {
    const { chatId, login } = await oauthFinish(code, state, redirect);
    const botRow = await prisma.bot.findFirst({ where: process.env.CODER_BOT_ID ? { id: process.env.CODER_BOT_ID } : { template: "NOVA_BOT", isActive: true } }).catch(() => null);
    if (botRow) await new Bot(botRow.token).api.sendMessage(chatId, `🔗 رُبط حساب GitHub ‏@${login} بـ Nova AI. يمكنك الآن العمل على مستودعاتك.`).catch(() => null);
    return page("تم ربط GitHub", `الحساب ‎@${esc(login)}‎ مربوط الآن. ارجع إلى تيليجرام.`, true);
  } catch (e) {
    return page("تعذّر الربط", esc(e instanceof AppError ? e.message : "حدث خطأ؛ حاول مجدداً من التطبيق."), false);
  }
}
