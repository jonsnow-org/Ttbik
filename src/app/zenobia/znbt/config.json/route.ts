import { NextResponse } from "next/server";
import { getConfig } from "@/lib/znbtConfig";

// What the Zenobia platform pages read (master, ZNBt's coin, whether launches are open, when ZNBt was launched). See lib/znbtConfig.ts.
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getConfig(), { headers: { "Cache-Control": "no-store" } });
}
