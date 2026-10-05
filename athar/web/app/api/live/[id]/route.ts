import { imgResponse } from "@/lib/handlers";
import { isHiddenRef, isHiddenToken } from "@/lib/hidden";
import { tokenState, isBusy } from "@/lib/chain";
import { verdictOf } from "@/lib/feeaudit";
import { adminAddress } from "@/lib/config";
import { stageOf, ymd } from "@/lib/dates";
export const dynamic = "force-dynamic";

// A token's living portrait as it is TODAY, worked out from the chain: its own picture (a photo, if it has one and its fee was paid),
// its age stage, hands, engravings and occasion. Used by "my tokens" and anywhere a token must look like itself.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const index = Number((await params).id.replace(/\.svg$/, ""));
  let st;
  try { st = await tokenState(index); } catch (e) { if (!isBusy(e)) throw e; }
  const u = new URL(req.url);
  if (!st) return imgResponse(`${index}.svg`, `${u.origin}/api/img/${index}.svg?live=1`, { isHiddenRef });
  if (isHiddenToken(index)) return imgResponse("hidden.svg", u.origin, { isHiddenRef });
  const unpaid = (await verdictOf(st, adminAddress()?.toRawString() ?? null).catch(() => "ok" as const)) === "unpaid";
  const c = ymd(index), now = new Date();
  const ann = now.getUTCMonth() + 1 === c.m && now.getUTCDate() === c.d;
  const qs = new URLSearchParams({ s: String(st.season), g: String(stageOf(st.lastTransferAt)), h: String(st.hands), e: String(st.engravings.length), t: String(st.tier), o: String(st.occasion), live: "1" });
  if (ann) qs.set("ann", "1");
  if (st.mediaRef && !unpaid && !isHiddenRef(st.mediaRef)) qs.set("p", st.mediaRef);
  return imgResponse(`${index}.svg`, `${u.origin}/api/img/${index}.svg?${qs}`, { isHiddenRef });
}
