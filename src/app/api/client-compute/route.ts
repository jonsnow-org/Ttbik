import { NextResponse } from "next/server";
import { clientComputeEnabled } from "@/lib/novaSettings";

// Public, read-only: only the owner switch's boolean leaves the server (no secrets, no user data).
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ enabled: await clientComputeEnabled() });
}
