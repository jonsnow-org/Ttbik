import { collectionResponse } from "../../../../../athar/web/lib/handlers";
import { viaPrimary } from "@/lib/atharMirror";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  return (await viaPrimary("/api/collection")) ?? collectionResponse(origin, `${origin}/api/athar/img`);
}
