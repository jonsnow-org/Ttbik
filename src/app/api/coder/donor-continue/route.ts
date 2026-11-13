import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    { error: "candidate models are retired" },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
