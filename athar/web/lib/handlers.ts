// The three public answers of Athar (token picture, token metadata, collection metadata) as plain functions, so the SAME code can be
// served by every host we run: our own server, and the Vercel mirror (root site: /api/athar/*). Imports are relative on purpose:
// the root site compiles this file too and has no "@/" alias into this folder.
import { renderArt } from "./art";
import { liveArt, storedMotion } from "./live";
import { renderSpecialLive } from "./specialLive";
import { TOTAL_DATES, dateLabelAr, stageOf, ymd } from "./dates";
import { SEASON_1, seasonTier, specialIndex } from "./seasons";
import { tokenState } from "./chain";
import { tokenStory } from "./meta";
import { occasionById } from "./occasions";
import { META_BASE, SITE_URL, viewerUrl } from "./config";

const SPECIAL_DATES = new Set(SEASON_1.specials.map(specialIndex));
const SVG = { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, max-age=300" };

export function imgResponse(idParam: string, reqUrl: string): Response {
  const idRaw = idParam.replace(/\.svg$/, "");
  if (idRaw === "hidden") return new Response(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" width="800" height="800"><rect width="800" height="800" rx="56" fill="#0b1226"/><circle cx="400" cy="360" r="120" fill="none" stroke="#7aa2ff" stroke-width="5" opacity="0.6"/><path d="M330 360h140" stroke="#7aa2ff" stroke-width="8" stroke-linecap="round"/><text x="400" y="580" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="30" letter-spacing="6" fill="#7aa2ff">ATHAR</text></svg>`, { headers: SVG });
  const q = new URL(reqUrl).searchParams;
  const index = idRaw === "collection" ? 18262 + 1000 : Number(idRaw);
  if (!Number.isInteger(index) || index < 0 || index >= TOTAL_DATES) return new Response("bad id", { status: 400 });
  const num = (k: string, dflt: number) => { const v = Number(q.get(k)); return Number.isFinite(v) && q.get(k) !== null ? v : dflt; };
  const art = {
    index, tier: idRaw === "collection" ? 2 : num("t", seasonTier(SEASON_1, index)), season: num("s", 1), stage: Math.min(4, Math.max(0, num("g", idRaw === "collection" ? 4 : 0))),
    hands: Math.min(60, Math.max(0, num("h", idRaw === "collection" ? 12 : 0))), engravings: Math.min(99, Math.max(0, num("e", 0))), sealed: q.get("sealed") === "1", occasion: Math.min(9, Math.max(0, num("o", 0))),
  };
  // the 78 special dates have a drawing of their own (coloured, moving): that is also what a visitor sees before the date is sold
  if (idRaw !== "collection" && SPECIAL_DATES.has(index) && q.get("plain") !== "1") {
    const sp = renderSpecialLive(index);
    if (sp) return new Response(storedMotion(sp), { headers: SVG });
  }
  // ?live=1 is the site's moving version (?ann=1 on the date's anniversary); without it the plain picture wallets and markets show
  const svg = q.get("live") === "1" ? liveArt(renderArt(art), { stage: art.stage, tier: art.tier, anniversary: q.get("ann") === "1" }) : renderArt(art);
  return new Response(svg, { headers: SVG });
}

/** Hooks only our own server has (its takedown list and its picture queue); the mirror has neither and uses the defaults. */
export type MetaHooks = { isHiddenToken?: (index: number) => boolean; isHiddenRef?: (ref: string | null | undefined) => boolean; available?: (ref: string) => Promise<boolean> };
const gatewayHas = async (ref: string) => { try { const r = await fetch(`https://turbo-gateway.com/${ref}`, { method: "HEAD", signal: AbortSignal.timeout(4000) }); return r.ok; } catch { return false; } };

export async function metaResponse(idParam: string, origin = SITE_URL, imgBase = `${META_BASE}/img`, hooks: MetaHooks = {}): Promise<Response> {
  const isHiddenToken = hooks.isHiddenToken ?? (() => false), isHiddenRef = hooks.isHiddenRef ?? (() => false), available = hooks.available ?? gatewayHas;
  const index = Number(idParam.replace(/\.json$/, ""));
  if (!Number.isInteger(index) || index < 0 || index >= TOTAL_DATES) return Response.json({ error: "bad id" }, { status: 400 });
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
  return Response.json({
    // one name for every viewer (markets index the file once): English first, the community that trades tokens; the Arabic name sits in the attributes
    name: `Athar · ${story.dateEn}`,
    description: story.description,
    // markets that play animated pages show the living picture; the rest keep using `image`
    ...(!st?.mediaRef && !hidden ? { animation_url: viewerUrl({ i: index, t: tier, s: st?.season ?? 1, g: stage, h: st?.hands ?? 1, e: st?.engravings.length ?? 0, o: st?.occasion ?? 0 }) } : {}),
    external_url: `${origin}/token/${index}`,
    // the picture markets show: an SVG with its motion built in (Getgems lists svg among its image formats): browsers play it, apps
    // that only draw still pictures show the first frame. A picture the owner chose is shown as it was stored.
    image: hidden ? `${imgBase}/hidden.svg` : permanent ?? `${imgBase}/${index}.svg${q}&live=1`,
    // Getgems shows these as buttons on the token's page (label up to 24 characters)
    ...(!hidden ? { buttons: [{ label: "Open on Athar", uri: `${origin}/token/${index}` }, { label: "Living view", uri: viewerUrl({ i: index, t: tier, s: st?.season ?? 1, g: stage, h: st?.hands ?? 1, e: st?.engravings.length ?? 0, o: st?.occasion ?? 0 }) }] } : {}),
    attributes: [...story.attrs, { trait_type: "Name (Arabic)", value: `أثر · ${dateLabelAr(y, m, d)}` }],
  }, { headers: { "Cache-Control": "public, max-age=60" } });
}

export function collectionResponse(origin = SITE_URL, imgBase = `${META_BASE}/img`): Response {
  return Response.json({
    name: "Athar",
    description: "One token for every day of the calendar (1950–2049). It remembers everyone who owned it and matures the longer it is held. By Sham AI.\n\nرمز لكل يوم في التقويم (1950–2049). يحفظ ذاكرة كل من امتلكه، ويكبر شكله بطول الاحتفاظ به. من شام AI.",
    image: `${imgBase}/collection.svg`,
    external_url: origin,
    social_links: [],
  });
}
