import { metaResponse } from "../../../../../../athar/web/lib/handlers";
import { ATHAR_SITE, viaPrimary } from "@/lib/atharMirror";
export const dynamic = "force-dynamic";
export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const hit = await viaPrimary(`/api/m/${params.id}`);
  if (hit) return hit;
  if (!process.env.ATHAR_ADMIN && !process.env.NEXT_PUBLIC_ATHAR_ADMIN) return Response.json({ error: "mirror is not configured" }, { status: 503 });
  const origin = new URL(req.url).origin;
  // links ("Open on Athar", external_url) always go to Athar's own site, never to this mirror's address (which has no token pages)
  return metaResponse(params.id, ATHAR_SITE, `${origin}/api/athar/img`);
}
