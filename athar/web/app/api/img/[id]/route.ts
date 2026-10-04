import { renderArt } from "@/lib/art";
import { TOTAL_DATES } from "@/lib/dates";
import { SEASON_1, seasonTier } from "@/lib/seasons";
export const dynamic = "force-dynamic";
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const idRaw = params.id.replace(/\.svg$/, "");
  if (idRaw === "hidden") return new Response(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" width="800" height="800"><rect width="800" height="800" rx="56" fill="#0b1226"/><circle cx="400" cy="360" r="120" fill="none" stroke="#7aa2ff" stroke-width="5" opacity="0.6"/><path d="M330 360h140" stroke="#7aa2ff" stroke-width="8" stroke-linecap="round"/><text x="400" y="580" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="30" letter-spacing="6" fill="#7aa2ff">ATHAR</text></svg>`, { headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, max-age=300" } });
  const q = new URL(req.url).searchParams;
  const index = idRaw === "collection" ? 18262 + 1000 : Number(idRaw);
  if (!Number.isInteger(index) || index < 0 || index >= TOTAL_DATES) return new Response("bad id", { status: 400 });
  const num = (k: string, dflt: number) => { const v = Number(q.get(k)); return Number.isFinite(v) && q.get(k) !== null ? v : dflt; };
  const svg = renderArt({
    index, tier: idRaw === "collection" ? 2 : num("t", seasonTier(SEASON_1, index)), season: num("s", 1), stage: Math.min(4, Math.max(0, num("g", idRaw === "collection" ? 4 : 0))),
    hands: Math.min(60, Math.max(0, num("h", idRaw === "collection" ? 12 : 0))), engravings: Math.min(99, Math.max(0, num("e", 0))), sealed: q.get("sealed") === "1", occasion: Math.min(9, Math.max(0, num("o", 0))),
  });
  return new Response(svg, { headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}
