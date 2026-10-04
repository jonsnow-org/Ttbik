import { NextResponse } from "next/server";
import { processQueue } from "@/lib/mediaQueue";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
// Called every few minutes by the update agent (same secret as the management panel). Works through the waiting pictures.
export async function POST(req: Request) {
  const s = process.env.ATHAR_ADMIN_PATH || "";
  if (!s || req.headers.get("x-athar-adm") !== s) return new Response("Not Found", { status: 404 });
  return NextResponse.json(await processQueue());
}
