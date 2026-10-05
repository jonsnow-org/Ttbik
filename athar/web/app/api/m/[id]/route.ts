import { metaResponse } from "@/lib/handlers";
import { isHiddenRef, isHiddenToken } from "@/lib/hidden";
import { available } from "@/lib/mediaQueue";
import { verdictOf } from "@/lib/feeaudit";
import { adminAddress } from "@/lib/config";
export const dynamic = "force-dynamic";
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  return metaResponse((await params).id, undefined, undefined, { isHiddenToken, isHiddenRef, available, pictureAllowed: async (t) => (await verdictOf(t, adminAddress()?.toRawString() ?? null)) === "ok" });
}
