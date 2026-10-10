import { imgResponse } from "@/lib/handlers";
import { isHiddenRef, isHiddenToken } from "@/lib/hidden";
import { PNG_HEADERS, svgToPng } from "@/lib/png";
import { tokenState, isBusy } from "@/lib/chain";
import { stageOf, ymd } from "@/lib/dates";
import { dateOf } from "@/lib/kinds";
export const dynamic = "force-dynamic";

// A token's living portrait as it is TODAY, worked out from the chain: its own picture (a photo, if it has one and its fee was paid),
// its age stage, hands, engravings and occasion. Used by "my tokens" and anywhere a token must look like itself.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const rawId = (await params).id, wantPng = rawId.endsWith(".png");
  const index = Number(rawId.replace(/\.(svg|png)$/, ""));
  let st;
  try { st = await tokenState(index); } catch (e) { if (!isBusy(e)) throw e; }
  const u = new URL(req.url);
  const out = async (r: Response) => (wantPng && r.ok ? new Response(new Uint8Array(await svgToPng(await r.text())), { headers: PNG_HEADERS }) : r);
  if (!st) return out(await imgResponse(`${index}.svg`, `${u.origin}/api/img/${index}.svg${wantPng ? "" : "?live=1"}`, { isHiddenRef }));
  if (isHiddenToken(index)) return out(await imgResponse("hidden.svg", u.origin, { isHiddenRef }));
  const c = ymd(dateOf(index)), now = new Date();
  const ann = now.getUTCMonth() + 1 === c.m && now.getUTCDate() === c.d;
  const qs = new URLSearchParams({ s: String(st.season), g: String(stageOf(st.lastTransferAt)), h: String(st.hands), e: String(st.engravings.length), t: String(st.tier), o: String(st.occasion) });
  if (!wantPng) qs.set("live", "1");
  if (ann) qs.set("ann", "1");
  if (st.mediaRef && !isHiddenRef(st.mediaRef)) qs.set("p", st.mediaRef);
  return out(await imgResponse(`${index}.svg`, `${u.origin}/api/img/${index}.svg?${qs}`, { isHiddenRef }));
}
