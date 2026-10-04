import { NextResponse } from "next/server";
import { hide, listHidden, unhide } from "@/lib/hidden";
export const dynamic = "force-dynamic";

// Management only (same secret as the panel). Hides or restores what the app and the token metadata show for a token / stored file.
const deny = (req: Request) => { const s = process.env.ATHAR_ADMIN_PATH || ""; return !s || req.headers.get("x-athar-adm") !== s; };
export async function GET(req: Request) {
  if (deny(req)) return new Response("Not Found", { status: 404 });
  return NextResponse.json({ rows: listHidden() });
}
export async function POST(req: Request) {
  if (deny(req)) return new Response("Not Found", { status: 404 });
  const b = await req.json().catch(() => null);
  const kind = b?.kind === "ref" ? "ref" : "token";
  const key = String(b?.key || "").trim();
  if (!key || (kind === "token" && !/^\d{1,5}$/.test(key)) || (kind === "ref" && !/^[A-Za-z0-9_-]{43}$/.test(key))) return NextResponse.json({ error: "bad key" }, { status: 400 });
  if (b?.action === "unhide") unhide(kind, key); else hide(kind, key, String(b?.note || ""));
  return NextResponse.json({ rows: listHidden() });
}
