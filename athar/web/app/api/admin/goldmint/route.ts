import { NextResponse } from "next/server";
import { renderPhotoArt } from "@/lib/art";
import { badgeMotion } from "@/lib/live";
import { TOTAL_DATES } from "@/lib/dates";
import { SEASON_1, seasonTier } from "@/lib/seasons";
import { MAX_BYTES, storeNow } from "@/lib/storage";
import { enqueue } from "@/lib/mediaQueue";
import { imageSize } from "@/lib/imgsize";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Management only. The owner's own gold-wax mint: any date, a photo (a famous person, for example) already given the gold-wax treatment
// in the browser, framed in gold with the date's own rosette kept as the small badge. The owner pays no picture fee; the picture is
// stored for good and its id goes into his purchase. (Others cannot use this route: it needs the secret management address.)
const deny = (req: Request) => { const s = process.env.ATHAR_ADMIN_PATH || ""; return !s || req.headers.get("x-athar-adm") !== s; };
export async function POST(req: Request) {
  if (deny(req)) return new Response("Not Found", { status: 404 });
  const b = await req.json().catch(() => null);
  const index = Number(b?.index), occasion = Number(b?.occasion || 0), preview = !!b?.preview;
  if (!Number.isInteger(index) || index < 0 || index >= TOTAL_DATES) return NextResponse.json({ error: "bad date" }, { status: 400 });
  if (!Number.isInteger(occasion) || occasion < 0 || occasion > 9) return NextResponse.json({ error: "bad occasion" }, { status: 400 });
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(b?.photo || ""));
  if (!m) return NextResponse.json({ error: "photo must be a JPEG" }, { status: 400 });
  const buf = Buffer.from(m[1], "base64");
  const dims = imageSize(buf);
  if (!dims) return NextResponse.json({ error: "not a valid image" }, { status: 400 });
  const svg = badgeMotion(renderPhotoArt({ index, tier: seasonTier(SEASON_1, index), season: SEASON_1.id, stage: 0, hands: 1, engravings: 0, occasion, gold: true }, `data:image/jpeg;base64,${m[1]}`, dims));
  if (Buffer.byteLength(svg) > MAX_BYTES) return NextResponse.json({ error: `picture too large (${Math.round(Buffer.byteLength(svg) / 1024)} KB), choose a smaller photo` }, { status: 413 });
  if (preview) return NextResponse.json({ svg });
  try {
    const st = await storeNow(svg);
    if (!st.readable) await enqueue(svg).catch(() => undefined);
    return NextResponse.json({ id: st.id, ref: st.ref.toString(), readable: st.readable });
  } catch (e) {
    console.error("[admin/goldmint] store failed", e);
    return NextResponse.json({ error: "permanent storage is not reachable right now, try again" }, { status: 502 });
  }
}
