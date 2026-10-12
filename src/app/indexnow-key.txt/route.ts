import { INDEXNOW_KEY } from "@/lib/indexNow";

export function GET() {
  return new Response(INDEXNOW_KEY, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
