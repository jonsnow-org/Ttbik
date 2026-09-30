"use client";

import PayForm from "@/components/pay/PayForm";

// Thin wrapper: this bot's OWN invoice endpoint (own ledger), shared UI.
export default function PayClient({ uid, justPaid }: { uid: string; justPaid: boolean }) {
  return <PayForm uid={uid} justPaid={justPaid} endpoint="/api/payments/create-invoice" botName="بوت الإعلانات (شاهد واربح)" defaultAmount={10} />;
}
