import { NextResponse } from "next/server";
import { tokenState } from "@/lib/chain";
import { isHiddenRef, isHiddenToken } from "@/lib/hidden";
export const dynamic = "force-dynamic";
export async function GET(_: Request, { params }: { params: { index: string } }) {
  const t = await tokenState(Number(params.index));
  if (!t) return NextResponse.json({ error: "not minted" }, { status: 404 });
  const hideAll = isHiddenToken(t.index);
  const media = t.media.filter((m) => !hideAll && !isHiddenRef(m.ref));
  const mediaRef = t.mediaRef && !hideAll && !isHiddenRef(t.mediaRef) ? t.mediaRef : null;
  return NextResponse.json({ ...t, media, mediaRef, pictureHidden: !!t.mediaRef && !mediaRef });
}
