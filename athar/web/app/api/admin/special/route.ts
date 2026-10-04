import { NextResponse } from "next/server";
import { renderPhotoArt } from "@/lib/art";
import { TOTAL_DATES } from "@/lib/dates";
import { SEASON_1, specialIndex } from "@/lib/seasons";
import { storeNow } from "@/lib/storage";
import { enqueue } from "@/lib/mediaQueue";
import { imageSize } from "@/lib/imgsize";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Management only. Builds the gold artwork of a special date from a picture the admin chose (already given the waxed-gold
// treatment in the browser) and, unless preview, stores it permanently. The returned `ref` goes into the date's auction,
// so bidders see exactly the picture the winner's token will carry.
const MAX_PHOTO = 68_000;
const deny = (req: Request) => { const s = process.env.ATHAR_ADMIN_PATH || ""; return !s || req.headers.get("x-athar-adm") !== s; };
export async function POST(req: Request) {
  if (deny(req)) return new Response("Not Found", { status: 404 });
  const b = await req.json().catch(() => null);
  const index = Number(b?.index), preview = !!b?.preview;
  if (!Number.isInteger(index) || index < 0 || index >= TOTAL_DATES || !SEASON_1.specials.some((s) => specialIndex(s) === index)) return NextResponse.json({ error: "not a special date" }, { status: 400 });
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(b?.photo || ""));
  if (!m) return NextResponse.json({ error: "photo must be a JPEG" }, { status: 400 });
  const buf = Buffer.from(m[1], "base64");
  if (buf.length > MAX_PHOTO) return NextResponse.json({ error: `photo too large (${Math.round(buf.length / 1024)} KB, max ${Math.round(MAX_PHOTO / 1024)} KB)` }, { status: 413 });
  const dims = imageSize(buf);
  if (!dims) return NextResponse.json({ error: "not a valid image" }, { status: 400 });
  const svg = renderPhotoArt({ index, tier: 2, season: SEASON_1.id, stage: 0, hands: 1, engravings: 0 }, `data:image/jpeg;base64,${m[1]}`, dims);
  if (preview) return NextResponse.json({ svg });
  try {
    const st2 = await storeNow(svg);
    if (!st2.readable) await enqueue(svg).catch(() => undefined);
    return NextResponse.json({ id: st2.id, url: `https://turbo-gateway.com/${st2.id}`, ref: st2.ref.toString(), readable: st2.readable });
  } catch (e) {
    console.error("[admin/special] store failed", e);
    return NextResponse.json({ error: "permanent storage is not reachable right now, try again" }, { status: 502 });
  }
}
