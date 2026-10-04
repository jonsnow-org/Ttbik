import { metaResponse } from "@/lib/handlers";
export const dynamic = "force-dynamic";
export async function GET(_: Request, { params }: { params: { id: string } }) { return metaResponse(params.id); }
