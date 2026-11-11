import { prisma } from "@/lib/prisma";
import { timedClickStatus, normalizeTargetUrl } from "@/lib/watchTarget";
import WatchClient, { type ClickData } from "./WatchClient";

const REQUIRED_SECONDS = 15;

export const dynamic = "force-dynamic";

export default async function WatchPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const click = await prisma.adClick.findUnique({ where: { id: token } });
  if (!click) {
    return <WatchClient token={token} initialError="الرابط غير صالح أو منتهي." initialData={null} />;
  }
  const ad = await prisma.ad.findUnique({ where: { id: click.adId } });
  if (!ad || ad.status !== "ACTIVE" || (Number(ad.cpc) > 0 && Number(ad.remaining) < Number(ad.cpc))) {
    return <WatchClient token={token} initialError="هذا الإعلان لم يعد متاحاً أو انتهت ميزانيته." initialData={null} />;
  }
  const status = timedClickStatus(click, Date.now(), REQUIRED_SECONDS);
  const initialData: ClickData = {
    ok: true,
    started: status.started,
    remainingSeconds: status.remainingSeconds,
    requiredSeconds: REQUIRED_SECONDS,
    description: ad.description ? String(ad.description) : null,
    targetUrl: normalizeTargetUrl(ad.type, ad.content, click.id),
  };
  return <WatchClient token={token} initialError={null} initialData={initialData} />;
}
