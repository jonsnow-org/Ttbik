import { NextRequest, NextResponse } from "next/server";
import { prismaDb } from "@/lib/coderAuth";
import { executeDonorTool } from "@/lib/donorToolBridge";

export const dynamic = "force-dynamic";
export const maxDuration = 35;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as Record<string, any> | null;
  if (!body || typeof body.ticket !== "string" || typeof body.model !== "string" || typeof body.name !== "string") {
    return NextResponse.json({ ok: false, error: "invalid bridge request" }, { status: 400 });
  }
  const args = body.arguments && typeof body.arguments === "object" && !Array.isArray(body.arguments)
    ? body.arguments as Record<string, unknown>
    : {};
  try {
    const result = await executeDonorTool({
      ticket: body.ticket,
      model: body.model,
      name: body.name,
      arguments: args,
    }, prismaDb);
    return NextResponse.json(result, { status: result.ok ? 200 : 403, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[donor-tool-bridge]", String((error as Error)?.message || error).slice(0, 240));
    return NextResponse.json({ ok: false, error: "connector tool execution failed" }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
