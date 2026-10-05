import { NextResponse } from "next/server";
import { top } from "@/lib/waitlist";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const s = process.env.ATHAR_ADMIN_PATH || "";
  if (!s || req.headers.get("x-athar-adm") !== s) return new Response("Not Found", { status: 404 });
  return NextResponse.json(top());
}
