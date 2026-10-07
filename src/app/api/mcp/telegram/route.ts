import { NextRequest, NextResponse } from "next/server";
import { findAdmenBot } from "@/lib/siteAds";

export const dynamic = "force-dynamic";

function allowed(req: NextRequest) {
  const expected = (process.env.ADMIN_PASSWORD || "").trim();
  if (!expected) return false;
  const header = req.headers.get("authorization") || "";
  const cookie = req.cookies.get("ttbik_admin")?.value || "";
  return header === `Bearer ${expected}` || cookie === expected;
}

async function token() {
  const bot = await findAdmenBot();
  return bot?.token || "";
}

async function tg(method: string) {
  const key = await token();
  if (!key) return { ok: false, error: "البوت غير مربوط" };
  const res = await fetch(`https://api.telegram.org/bot${key}/${method}`);
  return res.json();
}

export async function POST(req: NextRequest) {
  if (!allowed(req)) return NextResponse.json({ error: "forbidden" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const id = body.id ?? null;
  if (body.method === "initialize") {
    return NextResponse.json({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "sham-telegram", version: "1" } } });
  }
  if (body.method === "tools/list") {
    return NextResponse.json({
      jsonrpc: "2.0",
      id,
      result: {
        tools: [
          { name: "bot_status", description: "اسم بوت الإعلان وحالة الويب هوك", inputSchema: { type: "object", properties: {} } },
          { name: "ping_admin", description: "رسالة اختبار إلى إدارة البوت فقط", inputSchema: { type: "object", properties: { text: { type: "string" } } } },
        ],
      },
    });
  }
  if (body.method === "tools/call" && body.params?.name === "bot_status") {
    const me = await tg("getMe");
    const hook = await tg("getWebhookInfo");
    const text = `البوت: @${me?.result?.username || "غير معروف"}\nالويب هوك: ${hook?.result?.url || "فارغ"}`;
    return NextResponse.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } });
  }
  if (body.method === "tools/call" && body.params?.name === "ping_admin") {
    const key = await token();
    const chat = process.env.TELEGRAM_ADMIN_CHAT_ID || process.env.SUPER_ADMIN_TELEGRAM_ID || "";
    if (!key || !chat) return NextResponse.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "إدارة البوت غير مضبوطة" }] } });
    await fetch(`https://api.telegram.org/bot${key}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: String(body.params?.arguments?.text || "اختبار ربط جروك") }),
    });
    return NextResponse.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "أُرسلت إلى الإدارة فقط" }] } });
  }
  return NextResponse.json({ jsonrpc: "2.0", id, result: {} });
}
