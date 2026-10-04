import { metaResponse } from "../../../../../../athar/web/lib/handlers";
import { viaPrimary } from "@/lib/atharMirror";
export const dynamic = "force-dynamic";
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const hit = await viaPrimary(`/api/m/${params.id}`);
  if (hit) return hit;
  if (!process.env.ATHAR_ADMIN && !process.env.NEXT_PUBLIC_ATHAR_ADMIN) return Response.json({ error: "mirror is not configured" }, { status: 503 });
  const origin = new URL(req.url).origin;
  return metaResponse(params.id, origin, `${origin}/api/athar/img`);
}
