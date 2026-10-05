import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { renderArt, renderPhotoArt } from "@/lib/art";
import { TOTAL_DATES, ymd } from "@/lib/dates";
import { SEASON_1, seasonTier } from "@/lib/seasons";
import { MAX_BYTES, storeNow } from "@/lib/storage";
import { enqueue } from "@/lib/mediaQueue";
import { badgeMotion, liveArt, storedMotion } from "@/lib/live";
import { OCCASIONS } from "@/lib/occasions";
import { imageSize } from "@/lib/imgsize";
import { tokenState } from "@/lib/chain";
import { stageOf } from "@/lib/dates";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Builds the final picture of a token and (unless preview) stores it permanently.
//   kind "photo":    the owner's photo in the frame, date as a small badge
//   kind "snapshot": the generated art, frozen for good
//   kind "special":  the special artwork of a historic date (file in web/special/YYYY-MM-DD.webp|jpg|png), date as a small badge
const MAX_PHOTO = 68_000;
const hits = new Map<string, number[]>();
function limited(ip: string) {
  const now = Date.now(), list = (hits.get(ip) || []).filter((t) => now - t < 3600_000);
  list.push(now); hits.set(ip, list);
  return list.length > 24;
}
function mimeOf(buf: Buffer): string | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length > 12 && buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return "image/webp";
  return null;
}

export async function POST(req: Request) {
  const ip = (req.headers.get("x-forwarded-for") || "x").split(",")[0].trim();
  const b = await req.json().catch(() => null);
  if (!b) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const index = Number(b.index), kind = String(b.kind || "photo"), occasion = Number(b.occasion || 0), preview = !!b.preview;
  if (!Number.isInteger(index) || index < 0 || index >= TOTAL_DATES) return NextResponse.json({ error: "bad date" }, { status: 400 });
  if (occasion !== 0 && !OCCASIONS.some((o) => o.id === occasion)) return NextResponse.json({ error: "bad occasion" }, { status: 400 });
  if (!preview && limited(ip)) return NextResponse.json({ error: "too many requests, try later" }, { status: 429 });

  const tier = seasonTier(SEASON_1, index);
  // for a token that already exists the picture reflects its real, on-chain state
  const st = await tokenState(index).catch(() => null);
  const base = st
    ? { index, tier: st.tier, season: st.season, stage: stageOf(st.lastTransferAt), hands: st.hands, engravings: st.engravings.length, occasion }
    : { index, tier, season: SEASON_1.id, stage: 0, hands: 1, engravings: 0, occasion };
  let svg: string;
  const notes: string[] = [];
  if (kind === "snapshot") {
    svg = renderArt(base);
  } else {
    let buf: Buffer | null = null;
    if (kind === "special") {
      const { y, m, d } = ymd(index);
      const stem = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      for (const ext of ["webp", "jpg", "png"]) {
        const f = path.join(process.cwd(), "special", `${stem}.${ext}`);
        if (fs.existsSync(f)) { buf = fs.readFileSync(f); break; }
      }
      if (!buf) return NextResponse.json({ error: "no special artwork for this date" }, { status: 404 });
    } else {
      const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(b.photo || ""));
      if (!m) return NextResponse.json({ error: "photo must be JPEG, PNG or WebP" }, { status: 400 });
      buf = Buffer.from(m[2], "base64");
    }
    if (buf.length > MAX_PHOTO) return NextResponse.json({ error: `photo too large (${Math.round(buf.length / 1024)} KB, max ${Math.round(MAX_PHOTO / 1024)} KB)` }, { status: 413 });
    const mime = mimeOf(buf);
    if (!mime) return NextResponse.json({ error: "not a valid image" }, { status: 400 });
    const dims = imageSize(buf);
    if (!dims) return NextResponse.json({ error: "not a valid image" }, { status: 400 });
    if (Math.min(dims.w, dims.h) < 200) notes.push("small");
    if (dims.w / dims.h < 0.25 || dims.w / dims.h > 4) notes.push("shape");
    svg = renderPhotoArt(base, `data:${mime};base64,${buf.toString("base64")}`, dims);
  }
  if (kind === "snapshot" && base.tier !== 2) svg = liveArt(svg, { stage: base.stage, tier: base.tier });   // going back to the original picture keeps all of its motion: turning rosette, breathing rim, twinkles
  else if (base.tier === 2) svg = storedMotion(svg);     // special/mythic pictures are stored with a quiet shimmer
  else svg = badgeMotion(svg);                      // every stored picture moves: the rosette or crystal, the photo's light, the badge
  if (Buffer.byteLength(svg) > MAX_BYTES) return NextResponse.json({ error: "picture too large for free permanent storage, choose a smaller photo" }, { status: 413 });
  if (preview) return NextResponse.json({ svg, notes });
  try {
    const st2 = await storeNow(svg);
    if (!st2.readable) await enqueue(svg).catch(() => undefined);       // keep it and keep trying: its id is already final
    return NextResponse.json({ id: st2.id, url: `https://turbo-gateway.com/${st2.id}`, ref: st2.ref.toString(), bytes: Buffer.byteLength(svg), readable: st2.readable, queued: !st2.readable });
  } catch (e) {
    console.error("[media/compose] store failed", e);
    return NextResponse.json({ error: "permanent storage is not reachable right now, try again" }, { status: 502 });
  }
}
