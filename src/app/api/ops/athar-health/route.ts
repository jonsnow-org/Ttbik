import { PRIMARY } from "@/lib/atharMirror";
export const dynamic = "force-dynamic";
// Is every layer that keeps Athar's tokens alive answering? (primary server, this mirror, the permanent viewer on the gateways)
const VIEWER_ID = "OLetZ3Dc82VnoqYZEFWs2fL9RO37NUfglvkKPh2gl_c";
type Probe = { ok: boolean; status: number; ms: number; error?: string };
async function probe(url: string, want: RegExp): Promise<Probe> {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000), cache: "no-store", redirect: "follow" });
    const body = await r.text();
    return { ok: r.ok && want.test(body.slice(0, 4000)), status: r.status, ms: Date.now() - t0 };
  } catch (e: any) { return { ok: false, status: 0, ms: Date.now() - t0, error: String(e?.message || e).slice(0, 80) }; }
}
const none: Probe = { ok: false, status: 0, ms: 0, error: "no primary configured" };
export async function GET(req: Request) {
  const self = new URL(req.url).origin;
  const [primaryImg, primaryMeta, mirrorImg, turbo, arweave] = await Promise.all([
    PRIMARY ? probe(`${PRIMARY}/api/img/1.svg`, /<svg/) : Promise.resolve(none),
    PRIMARY ? probe(`${PRIMARY}/api/m/18262`, /"attributes"/) : Promise.resolve(none),
    probe(`${self}/api/athar/img/1.svg`, /<svg/),
    probe(`https://turbo-gateway.com/${VIEWER_ID}`, /<!doctype html>/i),
    probe(`https://arweave.net/${VIEWER_ID}`, /<!doctype html>/i),
  ]);
  const checks = { primaryImg, primaryMeta, mirrorImg, viewerTurbo: turbo, viewerArweave: arweave };
  // the tokens survive as long as the mirror or the primary answers pictures and one gateway holds the viewer
  const alive = (primaryImg.ok || mirrorImg.ok) && (turbo.ok || arweave.ok);
  return Response.json({ alive, checks, at: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
}
