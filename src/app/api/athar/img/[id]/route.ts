import { imgResponse } from "../../../../../../athar/web/lib/handlers";
import { viaPrimary } from "@/lib/atharMirror";
export const dynamic = "force-dynamic";
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const u = new URL(req.url);
  return (await viaPrimary(`/api/img/${params.id}${u.search}`)) ?? imgResponse(params.id, req.url);
}
