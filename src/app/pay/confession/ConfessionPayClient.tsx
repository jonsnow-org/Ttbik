"use client";

import PayForm from "@/components/pay/PayForm";

// Thin wrapper: this bot's OWN invoice endpoint (own ledger), shared UI.
export default function ConfessionPayClient({ uid, justPaid }: { uid: string; justPaid: boolean }) {
  return <PayForm uid={uid} justPaid={justPaid} endpoint="/api/payments/confession-create-invoice" botName="بوت الاعترافات" defaultAmount={5} />;
}
