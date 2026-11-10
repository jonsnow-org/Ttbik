import type { Metadata } from "next";
import { dealsForChannel, listingByToken } from "@/lib/channels/exchange";
import { ManagePanel } from "@/components/channels/ExchangeClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "إدارة قناتي في البورصة", robots: { index: false, follow: false } };

export default async function ManagePage({ params }: { params: Promise<{ token: string }> }) {
  const token = (await params).token;
  const l = await listingByToken(token).catch(() => null);
  if (!l) return <main className="mx-auto max-w-xl px-4 py-8"><h1 className="text-xl font-extrabold">رابط الإدارة غير صحيح</h1></main>;
  const deals = l.viaPending || l.status !== "LISTED" ? [] : await dealsForChannel(l.username).catch(() => []);
  const listing = { username: l.username, title: l.title, status: l.status, price: l.price, verifyCode: l.status === "LISTED" ? null : l.verify_code, verified_until: l.verified_until ? l.verified_until.toISOString() : null };
  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-4 text-xl font-extrabold">إدارة قناتي في بورصة القنوات</h1>
      <ManagePanel token={token} initial={{ listing, deals: deals.map((d) => ({ ...d, created_at: undefined })) }} />
    </main>
  );
}
