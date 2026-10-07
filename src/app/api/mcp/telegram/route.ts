import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

async function bots() {
  return prisma.bot.findMany({ select: { id: true, token: true, template: true, isActive: true } });
}

async function byId(id: string) {
  const all = await bots();
  return all.find((b) => b.id === id) || null;
}

async function tg(token: string, method: string, payload?: object) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, payload ? {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  } : undefined);
  return res.json();
}

function reply(id: unknown, text: string) {
  return NextResponse.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } });
}

function allowed(req: NextRequest) {
  const expected = (process.env.ADMIN_PASSWORD || "").trim();
  if (!expected) return false;
  const header = req.headers.get("authorization") || "";
  const key = req.nextUrl.searchParams.get("key") || "";
  return header === `Bearer ${expected}` || key === expected;
}

export async function GET(req: NextRequest) {
  if (!allowed(req)) return NextResponse.json({ error: "forbidden" }, { status: 401 });
  return NextResponse.json({ name: "sham-telegram", ok: true });
}

export async function POST(req: NextRequest) {
  if (!allowed(req)) return NextResponse.json({ error: "forbidden" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const id = body.id ?? null;
  if (body.method === "initialize") {
    return NextResponse.json({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "sham-telegram", version: "2" } } });
  }
  if (body.method === "tools/list") {
    return NextResponse.json({
      jsonrpc: "2.0",
      id,
      result: {
        tools: [
          { name: "list_bots", description: "كل البوتات المخزنة بلا عرض التوكن", inputSchema: { type: "object", properties: {} } },
          { name: "bot_status", description: "حالة بوت واحد", inputSchema: { type: "object", properties: { botId: { type: "string" } }, required: ["botId"] } },
          { name: "send_as_bot", description: "إرسال رسالة باسم بوت مخزن إلى محادثة معروفة", inputSchema: { type: "object", properties: { botId: { type: "string" }, chatId: { type: "string" }, text: { type: "string" } }, required: ["botId", "chatId", "text"] } },
        ],
      },
    });
  }
  if (body.method !== "tools/call") return NextResponse.json({ jsonrpc: "2.0", id, result: {} });
  const name = body.params?.name;
  const args = body.params?.arguments || {};
  if (name === "list_bots") {
    const rows = await bots();
    const lines = [];
    for (const bot of rows) {
      const me = await tg(bot.token, "getMe");
      lines.push(`${bot.id} | @${me?.result?.username || "غير معروف"} | ${bot.template} | ${bot.isActive ? "نشط" : "موقوف"}`);
    }
    return reply(id, lines.join("\n") || "لا بوتات");
  }
  const bot = await byId(String(args.botId || ""));
  if (!bot) return reply(id, "البوت غير موجود في الجدول");
  if (name === "bot_status") {
    const me = await tg(bot.token, "getMe");
    const hook = await tg(bot.token, "getWebhookInfo");
    return reply(id, `@${me?.result?.username || "غير معروف"}\nالويب هوك: ${hook?.result?.url || "فارغ"}`);
  }
  if (name === "send_as_bot") {
    const sent = await tg(bot.token, "sendMessage", { chat_id: String(args.chatId || ""), text: String(args.text || "") });
    return reply(id, sent?.ok ? "أُرسلت" : "فشل الإرسال");
  }
  return reply(id, "أمر غير معروف");
}
