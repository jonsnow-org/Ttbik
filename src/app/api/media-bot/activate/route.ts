import { NextResponse } from "next/server";
import { ensureFrontDoor } from "@/lib/mediaFrontDoor";

// Opening this URL once switches the media bot to the Vercel front door
// (see ensureFrontDoor) — e.g. while Render is suspended and the bot can't
// start to do it itself. Safe to open any number of times.
export const dynamic = "force-dynamic";

export async function GET() {
  const r = await ensureFrontDoor().catch((e) => ({ ok: false, changed: false, detail: String(e) }));
  return NextResponse.json(r);
}
