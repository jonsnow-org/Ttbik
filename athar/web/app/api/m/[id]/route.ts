import { metaResponse } from "@/lib/handlers";
import { isHiddenRef, isHiddenToken } from "@/lib/hidden";
import { available } from "@/lib/mediaQueue";
export const dynamic = "force-dynamic";
export async function GET(_: Request, { params }: { params: { id: string } }) {
  return metaResponse(params.id, undefined, undefined, { isHiddenToken, isHiddenRef, available });
}
