import { prisma } from "@/lib/prisma";
import { normalizeTargetUrl } from "@/lib/watchTarget";
import WatchClient, { type ClickData } from "./WatchClient";

const REQUIRED_SECONDS = 15;

// A server component on purpose (owner report, 2026-09-06): the previous
// version fetched the click/target via a client-side useEffect, which put
// an unavoidable `await` between page-load and the automatic
// window.open(targetUrl) attempt — exactly the pattern mobile browsers and
// Telegram's in-app browser treat as "not a real user gesture" and block
// silently. Resolving the target here, before any HTML reaches the
// browser, lets the client component fire window.open() as the very first
// thing it does on mount, with zero intervening async work — the closest
// this can get to a genuine, unblocked auto-open.
export default async function WatchPage({ params }: { params: { token: string } }) {
  const click = await prisma.adClick.findUnique({ where: { id: params.token } });
  if (!click) {
    return <WatchClient token={params.token} initialError="الرابط غير صالح أو منتهي." initialData={null} />;
  }
  const ad = await prisma.ad.findUnique({ where: { id: click.adId } });
  if (!ad || ad.status !== "ACTIVE") {
    return <WatchClient token={params.token} initialError="هذا الإعلان لم يعد متاحاً." initialData={null} />;
  }
  const initialData: ClickData = {
    ok: true,
    verified: click.verified,
    issuedAt: click.issuedAt.toISOString(),
    requiredSeconds: REQUIRED_SECONDS,
    targetUrl: normalizeTargetUrl(ad.type, ad.content),
  };
  return <WatchClient token={params.token} initialError={null} initialData={initialData} />;
}
