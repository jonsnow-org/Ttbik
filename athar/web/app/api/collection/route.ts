import { collectionResponse } from "@/lib/handlers";
export const dynamic = "force-dynamic";
export async function GET() { return collectionResponse(); }
