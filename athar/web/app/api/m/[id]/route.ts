import { NextResponse } from "next/server";
import { tokenState } from "@/lib/chain";
import { dateLabelAr, MONTHS_EN, stageOf, STAGE_NAME_AR, TIER_NAME_AR, TIER_NAME_EN, ymd, TOTAL_DATES } from "@/lib/dates";
import { SEASON_1, seasonTier } from "@/lib/seasons";
import { SITE_URL } from "@/lib/config";
export const dynamic = "force-dynamic";
export async function GET(_: Request, { params }: { params: { id: string } }) {
  const index = Number(params.id.replace(/\.json$/, ""));
  if (!Number.isInteger(index) || index < 0 || index >= TOTAL_DATES) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const { y, m, d } = ymd(index);
  const st = await tokenState(index);
  const tier = st ? st.tier : seasonTier(SEASON_1, index);
  const stage = st ? stageOf(st.lastTransferAt) : 0;
  const attrs: { trait_type: string; value: string | number }[] = [
    { trait_type: "Date", value: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` },
    { trait_type: "Year", value: y }, { trait_type: "Month", value: MONTHS_EN[m - 1] },
    { trait_type: "Rarity", value: TIER_NAME_EN[tier] }, { trait_type: "الندرة", value: TIER_NAME_AR[tier] },
  ];
  if (st) attrs.push({ trait_type: "Season", value: st.season }, { trait_type: "Age stage", value: STAGE_NAME_AR[stage] }, { trait_type: "Hands", value: st.hands }, { trait_type: "Engravings", value: st.engravings.length }, { trait_type: "Edition", value: 1 });
  const permanent = st?.mediaRef ? `https://arweave.net/${st.mediaRef}` : null;
  if (st) attrs.push({ trait_type: "Occasion", value: st.occasion });
  const q = st ? `?s=${st.season}&g=${stage}&h=${st.hands}&e=${st.engravings.length}&t=${tier}` : `?t=${tier}`;
  return NextResponse.json({
    name: `أثر · ${dateLabelAr(y, m, d)}`,
    description: `رمز اليوم ${dateLabelAr(y, m, d)} — ${TIER_NAME_AR[tier]}. يحفظ ذاكرة كل من امتلكه.${st && st.engravings[0] ? `\nآخر نقش: ${st.engravings[0].text}` : ""}`,
    image: permanent ?? `${SITE_URL}/api/img/${index}.svg${q}`,
    attributes: attrs,
  }, { headers: { "Cache-Control": "public, max-age=60" } });
}
