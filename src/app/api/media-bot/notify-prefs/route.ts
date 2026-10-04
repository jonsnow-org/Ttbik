import { NextRequest, NextResponse } from "next/server";
import { mediaDb } from "@/lib/mediaSocial";
import { NOTIFY_TYPES, TYPE_LABEL_AR, isNotifyType, loadPrefs, savePrefs, type NotifyType } from "@/lib/mediaNotify";

export const dynamic = "force-dynamic";

const DEFAULT_SECRET = "8452320";
function secretOk(req: NextRequest): boolean {
  const expected = (process.env.FEED_SECRET || process.env.ADMIN_PASSWORD || DEFAULT_SECRET).trim();
  return !!expected && (req.headers.get("x-feed-secret") || "").trim() === expected;
}

/**
 * The media bot's side of notification settings (its "🔔 إشعاراتي" menu and the buttons under every notification).
 * The bot decides whether the account has the paid upgrade (it keeps the authoritative record) and sends `premium`;
 * stopping is only applied for paid accounts. Reading is open to the bot for any account.
 *   { tgUserId, action: "get" }
 *   { tgUserId, premium, action: "off" | "on", type: "like"|"comment"|"reply"|"follow"|"message"|"post"|"all" }
 */
export async function POST(req: NextRequest) {
  if (!secretOk(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const uid = String(b.tgUserId || "").trim();
  if (!/^\d{1,20}$/.test(uid)) return NextResponse.json({ ok: false, error: "bad user" }, { status: 400 });
  const db = await mediaDb();
  if (!db) return NextResponse.json({ ok: false, error: "database not configured" }, { status: 503 });

  const cur = await loadPrefs(db, uid);
  const view = (p: typeof cur) => ({ pushOff: p.pushOff, offTypes: p.offTypes, types: NOTIFY_TYPES.map((t) => ({ type: t, label: TYPE_LABEL_AR[t], on: !p.pushOff && !p.offTypes.includes(t) })) });
  const action = String(b.action || "get");
  if (action === "get") return NextResponse.json({ ok: true, ...view(cur) });

  const type = String(b.type || "all");
  if (type !== "all" && !isNotifyType(type)) return NextResponse.json({ ok: false, error: "bad type" }, { status: 400 });
  if (action === "off" && !b.premium) return NextResponse.json({ ok: false, error: "paid" }, { status: 402 });

  let next = { ...cur, offTypes: [...cur.offTypes] };
  if (action === "off") {
    if (type === "all") next.pushOff = true;
    else if (!next.offTypes.includes(type as NotifyType)) next.offTypes.push(type as NotifyType);
  } else if (action === "on") {
    if (type === "all") next = { pushOff: false, offTypes: [] };
    else next.offTypes = next.offTypes.filter((t) => t !== type);
  } else return NextResponse.json({ ok: false, error: "bad action" }, { status: 400 });

  const w = await savePrefs(db, uid, next);
  if (!w.ok) return NextResponse.json({ ok: false, error: "not saved" }, { status: 503 });
  return NextResponse.json({ ok: true, ...view(next) });
}
