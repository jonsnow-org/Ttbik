import type { Metadata } from "next";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "فضاء | جلسات مؤقتة",
  description: "جلسة مؤقتة لغرض واضح بإسهامات محددة ثم تُغلق.",
  robots: { index: true, follow: true },
};

export default function FadaaLayout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-400">فضاء...</div>}>{children}</Suspense>;
}
