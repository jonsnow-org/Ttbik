// studio-guard: the layer of the Sham training watch that does not depend on GitHub at all (owner's order 2026-11-18: training must never stop silently).
// Cron every 10 minutes: asks ModelScope (both sites) for each trainer Studio's state and calls the deploy API on any that is Sleeping / Stopped / Failed.
// Same list and rules as ai-system/modelscope-trainer/studio_guard.py (which also runs inside the trainer Studios and sham-runner-1, and in GitHub keep-awake).
// Nova 2 (coder-inference-server-16), the cn donor test Studios and the cn chat Studios (sham-v2-server, lfm25-inference-server): only woken when Sleeping. nova-inference-server and Athar are never listed.
// Secrets (Cloudflare, set by deploy-studio-guard-worker.yml from the GitHub secrets): MS_TOKEN_CN, MS_TOKEN_AI. KV binding LOG keeps the last 50 passes (no tokens).
// GET / with "Authorization: Bearer <MS_TOKEN_AI>": the last passes; ?check=1 runs a pass now without acting, ?act=1 runs a real pass. Anyone else gets 404.
const HOSTS = { cn: "www.modelscope.cn", ai: "www.modelscope.ai" };
export const STUDIOS = [
  ["cn", "novaai2026", "sham-trainer-1", "train"],
  // owner 2026-11-25: every trainer runs on cn; the international site is for serving only. ai sham-trainer-1 (Sham's T-LDM writer, ms1) -> cn sham-tldm-writer,
  // ai sham-trainer-tools (ms3) -> cn sham-trainer-tools. (ai sham-trainer-2 is Nova's computer hub despite its name; sham-runner-1 is the GitHub runner.)
  ["cn", "novaai2026", "sham-tldm-writer", "train"],
  ["cn", "novaai2026", "sham-trainer-tools", "train"],
  ["cn", "novaai2026", "sham2-tldm", "train"],
  ["cn", "novaai2026", "sham-donor-qwen35-9b-test", "warm"],
  ["cn", "novaai2026", "sham-donor-gemma4-e4b-test", "warm"],
  ["cn", "novaai2026", "sham-donor-minicpmo45-test", "warm"],
  ["cn", "novaai2026", "sham-v2-server", "warm"],            // chat Studios that keep-warm-chat-studios.yml covers (GitHub drops most of its cron runs)
  ["cn", "novaai2026", "lfm25-inference-server", "warm"],
  ["ai", "Jonjithup", "sham-trainer-2", "train"],              // Nova's computer hub despite the name (browserComputer.ts): kept up like a trainer
  ["ai", "Jonjithup", "sham-runner-1", "runner"],
  ["ai", "Jonjithup", "coder-inference-server-16", "warm"],
];

export function norm(s) {
  s = String(s || "").trim().toLowerCase();
  if (s === "sleeping") return "sleeping";
  if (s.includes("fail") || s.includes("error")) return "failed";
  if (s.includes("stop")) return "stopped";
  if (s === "running") return "running";
  return s || "unknown";
}

// '' | 'wake'. A Failed Studio is redeployed at most once an hour (minute < 10 of the hour), so a broken build does not loop every 10 minutes.
export function decide(status, policy, minute) {
  const st = norm(status);
  if (st === "sleeping") return "wake";
  if (policy === "warm") return "";
  if (st === "stopped") return "wake";
  if (st === "failed") return minute < 10 ? "wake" : "";
  return "";
}

async function call(url, tok, method = "GET") {
  try {
    const r = await fetch(url, { method, headers: { Authorization: "Bearer " + tok }, signal: AbortSignal.timeout(25000) });
    return { code: r.status, body: method === "GET" ? await r.text() : "" };
  } catch (e) {
    return { code: 0, body: String((e && e.name) || "error") };
  }
}

export async function pass(env, act, now = new Date()) {
  const out = [];
  for (const [site, owner, name, policy] of STUDIOS) {
    const tok = site === "cn" ? env.MS_TOKEN_CN : env.MS_TOKEN_AI;
    if (!tok) { out.push({ studio: `${site}/${owner}/${name}`, status: "no token" }); continue; }
    const r = await call(`https://${HOSTS[site]}/openapi/v1/studios/${owner}/${name}`, tok);
    let status = `HTTP ${r.code}`;
    if (r.code === 200) {
      try { const d = JSON.parse(r.body).data || {}; status = String((d.runtime || {}).status || d.status || ""); } catch (e) { status = "unreadable"; }
    }
    const action = decide(status, policy, now.getUTCMinutes());
    const rec = { studio: `${site}/${owner}/${name}`, status, action };
    if (action && act) rec.deploy = (await call(`https://${HOSTS[site]}/openapi/v1/studios/${owner}/${name}/deploy`, tok, "POST")).code;
    out.push(rec);
  }
  return { at: now.toISOString(), act, results: out };
}

async function remember(env, res) {
  if (!env.LOG) return;
  try {
    const old = JSON.parse((await env.LOG.get("passes")) || "[]");
    const keep = res.results.some((r) => r.action) ? [res, ...old] : [{ ...res, results: res.results.map(({ studio, status }) => ({ studio, status })) }, ...old];
    await env.LOG.put("passes", JSON.stringify(keep.slice(0, 50)));
  } catch (e) { /* the log is only for humans */ }
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(pass(env, true, new Date(event.scheduledTime)).then((res) => remember(env, res)));
  },
  async fetch(req, env) {
    if (!env.MS_TOKEN_AI || req.headers.get("Authorization") !== "Bearer " + env.MS_TOKEN_AI) return new Response("not found", { status: 404 });
    const u = new URL(req.url);
    if (u.searchParams.get("check") === "1" || u.searchParams.get("act") === "1") {
      const res = await pass(env, u.searchParams.get("act") === "1");
      if (res.act) await remember(env, res);
      return Response.json(res);
    }
    return Response.json({ passes: JSON.parse((env.LOG && (await env.LOG.get("passes"))) || "[]") });
  },
};
