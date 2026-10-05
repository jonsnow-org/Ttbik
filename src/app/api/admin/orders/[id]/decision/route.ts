import { NextRequest, NextResponse } from "next/server";
import { decideOrder } from "@/lib/orders";
import { isOwnerRequest } from "@/lib/isOwner";

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  // middleware.ts already blocks /api/admin/* without the owner cookie; this
  // check is a second, independent layer so this sensitive route (approve/
  // reject a paid order) stays protected even if the middleware matcher is
  // ever edited by mistake (it has happened once before in this project).
  if (!isOwnerRequest(req)) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  }

  const { action, note } = await req.json().catch(() => ({}));
  if (!["approve", "reject"].includes(action)) {
    return NextResponse.json({ error: "إجراء غير صالح" }, { status: 400 });
  }

  try {
    const order = await decideOrder(params.id, action === "approve" ? "approved" : "rejected", note);
    return NextResponse.json({ order });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "تعذّر تنفيذ الإجراء" }, { status: 500 });
  }
}
