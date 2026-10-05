import { collectionResponse } from "../../../../../athar/web/lib/handlers";
import { ATHAR_SITE, viaPrimary } from "@/lib/atharMirror";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  return (await viaPrimary("/api/collection")) ?? collectionResponse(ATHAR_SITE, `${origin}/api/athar/img`);
}
