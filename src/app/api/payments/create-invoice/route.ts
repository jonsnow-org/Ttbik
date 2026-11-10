import { NextRequest, NextResponse } from "next/server";
import { createWalletDepositInvoice } from "@/lib/walletDepositInvoice";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const r = await createWalletDepositInvoice(String(body.uid || "").trim(), body.amount);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ invoiceUrl: r.invoiceUrl });
}
