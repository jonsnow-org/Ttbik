import { NextResponse } from "next/server";
import { tokenState, isBusy } from "@/lib/chain";
import { isHiddenRef, isHiddenToken } from "@/lib/hidden";
export const dynamic = "force-dynamic";
export async function GET(_: Request, { params }: { params: { index: string } }) {
  let t;
  try { t = await tokenState(Number(params.index)); } catch (e) { if (isBusy(e)) return NextResponse.json({ error: "busy, try again in a moment" }, { status: 503, headers: { "Retry-After": "5" } }); throw e; }
  if (!t) return NextResponse.json({ error: "not minted" }, { status: 404 });
  const hideAll = isHiddenToken(t.index);
  const media = t.media.filter((m) => !hideAll && !isHiddenRef(m.ref));
  const mediaRef = t.mediaRef && !hideAll && !isHiddenRef(t.mediaRef) ? t.mediaRef : null;
  return NextResponse.json({ ...t, media, mediaRef, pictureHidden: !!t.mediaRef && !mediaRef });
}
