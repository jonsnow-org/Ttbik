import { imgResponse } from "../../../../../../athar/web/lib/handlers";
import { PNG_HEADERS, svgToPng } from "../../../../../../athar/web/lib/png";
import { viaPrimary } from "@/lib/atharMirror";
export const dynamic = "force-dynamic";
export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const u = new URL(req.url);
  const viaMain = await viaPrimary(`/api/img/${params.id}${u.search}`);
  if (viaMain) return viaMain;
  if (!params.id.endsWith(".png")) return imgResponse(params.id, req.url);
  // primary unreachable: draw the still picture here (wallets that cannot show the moving SVG)
  const r = await imgResponse(params.id.replace(/\.png$/, ".svg"), req.url);
  if (!r.ok) return r;
  const px = Math.min(800, Math.max(64, Number(u.searchParams.get("px")) || 800));
  return new Response(new Uint8Array(await svgToPng(await r.text(), px)), { headers: PNG_HEADERS });
}
