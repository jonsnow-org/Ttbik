import { NextResponse } from "next/server";
import { tokenState } from "@/lib/chain";
import { dateLabelAr, MONTHS_EN, stageOf, STAGE_NAME_AR, TIER_NAME_AR, TIER_NAME_EN, ymd, TOTAL_DATES } from "@/lib/dates";
import { SEASON_1, seasonTier } from "@/lib/seasons";
import { SITE_URL } from "@/lib/config";
import { isHiddenRef, isHiddenToken } from "@/lib/hidden";
import { tokenStory } from "@/lib/meta";
import { occasionById } from "@/lib/occasions";
import { available } from "@/lib/mediaQueue";
export const dynamic = "force-dynamic";
export async function GET(_: Request, { params }: { params: { id: string } }) {
  const index = Number(params.id.replace(/\.json$/, ""));
  if (!Number.isInteger(index) || index < 0 || index >= TOTAL_DATES) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const { y, m, d } = ymd(index);
  const st = await tokenState(index);
  const tier = st ? st.tier : seasonTier(SEASON_1, index);
  const stage = st ? stageOf(st.lastTransferAt) : 0;
  const story = tokenStory(index, st ? { season: st.season, tier, hands: st.hands, engravings: st.engravings.length, lastTransferAt: st.lastTransferAt, mintedAt: st.mintedAt, mediaRef: st.mediaRef, occasion: st.occasion, lastEngraving: st.engravings[0]?.text } : null, tier, stage, (id) => occasionById(id)?.names.en ?? null);
  const hidden = isHiddenToken(index) || isHiddenRef(st?.mediaRef);
  // a token may carry the id of a picture that is still on its way to the permanent network: until a gateway really serves it,
  // the token shows its default picture (and switches to the real one by itself)
  const permanent = st?.mediaRef && !hidden && (await available(st.mediaRef)) ? `https://turbo-gateway.com/${st.mediaRef}` : null;
  const q = st ? `?s=${st.season}&g=${stage}&h=${st.hands}&e=${st.engravings.length}&t=${tier}&o=${st.occasion}` : `?t=${tier}`;
  return NextResponse.json({
    name: `أثر · ${dateLabelAr(y, m, d)}`,
    description: story.description,
    external_url: `${SITE_URL}/token/${index}`,
    image: hidden ? `${SITE_URL}/api/img/hidden.svg` : permanent ?? `${SITE_URL}/api/img/${index}.svg${q}`,
    attributes: story.attrs,
  }, { headers: { "Cache-Control": "public, max-age=60" } });
}
