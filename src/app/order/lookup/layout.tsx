import type { Metadata } from "next";

export const metadata: Metadata = { title: "تتبّع طلبك", description: "أدخل رقم طلبك لتعرف حالته في شام AI." };

export default function OrderLookupLayout({ children }: { children: React.ReactNode }) { return children; }
