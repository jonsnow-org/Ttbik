// Vercel mirror of Athar's public answers (token picture, token metadata, collection metadata). The same code as our own server
// (athar/web/lib/handlers.ts); it asks the primary server first (so the legal takedown list there always applies) and answers by
// itself only when the primary does not answer in time. Needs, for metadata only, the same two settings as the primary
// (NEXT_PUBLIC_SITE_URL = the primary's address, ATHAR_ADMIN); pictures need nothing.
export const PRIMARY = (process.env.ATHAR_PRIMARY || process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");

export async function viaPrimary(path: string): Promise<Response | null> {
  if (!PRIMARY) return null;
  try {
    const r = await fetch(PRIMARY + path, { signal: AbortSignal.timeout(4000), cache: "no-store" });
    if (!r.ok) return null;
    return new Response(await r.arrayBuffer(), { status: 200, headers: { "Content-Type": r.headers.get("content-type") || "application/json", "Cache-Control": "public, max-age=60", "X-Athar-Served-By": "primary" } });
  } catch { return null; }
}
