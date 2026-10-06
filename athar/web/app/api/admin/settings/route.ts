import { NextResponse } from "next/server";
import { clearToncenterKey, keyAccepted, keyStatus, saveToncenterKey, validKey } from "@/lib/settings";
export const dynamic = "force-dynamic";

// Management only (needs the secret management address). The Toncenter key is write-only: it can be saved or removed, and only its
// source and last four characters can be read back.
const deny = (req: Request) => { const s = process.env.ATHAR_ADMIN_PATH || ""; return !s || req.headers.get("x-athar-adm") !== s; };

export async function GET(req: Request) {
  if (deny(req)) return new Response("Not Found", { status: 404 });
  return NextResponse.json(keyStatus());
}

export async function POST(req: Request) {
  if (deny(req)) return new Response("Not Found", { status: 404 });
  const b = await req.json().catch(() => null);
  if (b?.clear === true) { clearToncenterKey(); return NextResponse.json(keyStatus()); }
  const key = String(b?.key || "").trim();
  if (!validKey(key)) return NextResponse.json({ error: "bad key" }, { status: 400 });
  if (!(await keyAccepted(key))) return NextResponse.json({ error: "key refused by Toncenter" }, { status: 400 });
  saveToncenterKey(key);
  return NextResponse.json(keyStatus());
}
