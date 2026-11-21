// Pass-through to the terminal-mesh relay (cloudflare/sham-mesh-worker.js) for hosts that cannot reach workers.dev (ModelScope's mainland
// Studios). Nothing is decided or stored here: the request and its ed25519 signature go to the Worker unchanged (the signed path is relative
// to the relay root, so /api/mesh/m/<mesh>/<route> verifies as /m/<mesh>/<route>), and the Worker's answer comes back unchanged.
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RELAY = (process.env.SHAM_MESH_RELAY || "https://sham-mesh.jonsnowx1r.workers.dev").replace(/\/+$/, "");
const ROUTE = /^(health|m\/[a-z0-9-]{1,32}\/[a-z_]+)$/;
const FWD = ["content-type", "x-mesh-node", "x-mesh-ts", "x-mesh-sig"];

async function pass(req: NextRequest, path: string[]): Promise<Response> {
  const rel = (path || []).join("/");
  if (!ROUTE.test(rel)) return Response.json({ error: "not found" }, { status: 404 });
  const headers = new Headers({ "user-agent": "sham-mesh-proxy/1" });
  for (const h of FWD) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  const body = req.method === "GET" ? undefined : new Uint8Array(await req.arrayBuffer());
  if (body && body.length > 262_144) return Response.json({ error: "body too large" }, { status: 413 });
  try {
    const r = await fetch(`${RELAY}/${rel}${req.nextUrl.search}`, { method: req.method, headers, body, cache: "no-store", signal: AbortSignal.timeout(55_000) });
    return new Response(await r.arrayBuffer(), { status: r.status, headers: { "content-type": r.headers.get("content-type") || "application/json", "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "relay unreachable" }, { status: 502 });
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return pass(req, (await ctx.params).path);
}
export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return pass(req, (await ctx.params).path);
}
