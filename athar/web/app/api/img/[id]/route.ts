import { imgResponse } from "@/lib/handlers";
import { isHiddenRef } from "@/lib/hidden";
import { PNG_HEADERS, svgToPng } from "@/lib/png";
export const dynamic = "force-dynamic";
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  if (!id.endsWith(".png")) return imgResponse(id, req.url, { isHiddenRef });
  // the same picture as a still PNG (link previews, directories, raster-only wallets)
  const r = await imgResponse(id.replace(/\.png$/, ".svg"), req.url, { isHiddenRef });
  if (!r.ok) return r;
  return new Response(new Uint8Array(await svgToPng(await r.text())), { headers: PNG_HEADERS });
}
