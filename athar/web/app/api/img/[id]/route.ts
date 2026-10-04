import { imgResponse } from "@/lib/handlers";
export const dynamic = "force-dynamic";
export async function GET(req: Request, { params }: { params: { id: string } }) { return imgResponse(params.id, req.url); }
