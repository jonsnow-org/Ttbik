import { imgResponse } from "@/lib/handlers";
import { isHiddenRef } from "@/lib/hidden";
export const dynamic = "force-dynamic";
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) { return imgResponse((await params).id, req.url, { isHiddenRef }); }
