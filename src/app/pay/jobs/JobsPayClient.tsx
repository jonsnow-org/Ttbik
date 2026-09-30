"use client";

import PayForm from "@/components/pay/PayForm";

// Thin wrapper: this bot's OWN invoice endpoint (own ledger), shared UI.
export default function JobsPayClient({ uid, justPaid }: { uid: string; justPaid: boolean }) {
  return <PayForm uid={uid} justPaid={justPaid} endpoint="/api/payments/jobs-create-invoice" botName="بوت فرص العمل والمتجر" defaultAmount={10} />;
}
