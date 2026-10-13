import { NextResponse } from "next/server";
import { makeHidePayload } from "@/lib/znbtHide";
import { hideSecret } from "@/lib/znbtHideDb";

export const dynamic = "force-dynamic";

/** The owner page asks for the ton_proof payload to sign. */
export async function POST() {
  const secret = await hideSecret();
  if (!secret) return NextResponse.json({ error: "not configured" }, { status: 503 });
  return NextResponse.json({ payload: makeHidePayload(secret) });
}
