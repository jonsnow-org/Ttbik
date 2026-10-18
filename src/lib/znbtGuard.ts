// Hourly watch over what ZNBt depends on for ever (docs/zenobia/ZNBT-LAUNCH.md, "Frozen rules"): the coin's image address, the gate, both servers,
// and (after launch) the coin and the master on the chain. A problem is sent to the owner once every 6 hours until it is gone.
import { prisma } from "@/lib/prisma";
import { HOSTING, ensureHostingTables, notifyOwner, probeOrigin } from "@/lib/hostingOps";
import { getConfig } from "@/lib/znbtConfig";

export type Finding = { key: string; level: "problem" | "info"; text: string };
export type Facts = {
  icon: { status: number; type: string; servedBy: string };
  gate: boolean; oracle: boolean; vercel: boolean;
  chain: { master: "active" | "other" | "unknown"; curve: "active" | "other" | "unknown" | "none" };
};

/** The pure decision: what is wrong, given the facts. */
export function evaluate(f: Facts): Finding[] {
  const out: Finding[] = [];
  if (f.icon.status !== 200 || !f.icon.type.includes("image")) out.push({ key: "icon", level: "problem", text: `صورة ZNBt المكتوبة في العملة لا تعمل (HTTP ${f.icon.status}). The coin's on-chain image address is failing.` });
  else if (["builtin", "kept-old"].includes(f.icon.servedBy)) out.push({ key: "icon-fallback", level: "problem", text: `الصورة تُخدَم الآن من النسخة الاحتياطية (${f.icon.servedBy}) لأن الخادمين لا يردّان. The icon is served from the safety copy.` });
  if (!f.gate) out.push({ key: "gate", level: "problem", text: "البوابة لا تردّ: كل الروابط والويبهوكات وصورة العملة تمر بها. The gate is not answering." });
  if (!f.oracle && !f.vercel) out.push({ key: "servers", level: "problem", text: "الخادمان (Oracle وVercel) لا يردّان. Both servers are down." });
  else if (!f.oracle) out.push({ key: "oracle", level: "info", text: "Oracle لا يرد؛ البوابة تخدم من Vercel." });
  else if (!f.vercel) out.push({ key: "vercel", level: "info", text: "Vercel (الاحتياطي) لا يرد." });
  if (f.chain.curve !== "none") {
    if (f.chain.curve === "other") out.push({ key: "curve", level: "problem", text: "عقد ZNBt لم يعد «active» على السلسلة! The coin contract is not active on the chain." });
    if (f.chain.master === "other") out.push({ key: "master", level: "problem", text: "عقد المنصة (master) لم يعد «active» على السلسلة! The master contract is not active." });
  }
  return out;
}

async function chainState(addr: string): Promise<"active" | "other" | "unknown"> {
  try {
    const key = process.env.TONCENTER_API_KEY;
    const r = await fetch(`https://toncenter.com/api/v2/getAddressInformation?address=${encodeURIComponent(addr)}`, { headers: key ? { "X-API-Key": key } : {}, signal: AbortSignal.timeout(8000), cache: "no-store" });
    const j: any = await r.json();
    return j?.ok ? (j.result.state === "active" ? "active" : "other") : "unknown";
  } catch { return "unknown"; }
}

export async function gatherFacts(): Promise<Facts> {
  const cfg = await getConfig();
  const gate = HOSTING.gateUrl.replace(/\/$/, "");
  const icon = await fetch(`${gate}/api/zenobia/znbt/icon`, { cache: "no-store", signal: AbortSignal.timeout(15000) }).then((r) => ({ status: r.status, type: r.headers.get("content-type") || "", servedBy: r.headers.get("x-gate-origin") || "" })).catch(() => ({ status: 0, type: "", servedBy: "" }));
  const [g, o, v] = await Promise.all([fetch(`${gate}/__gate/state`, { cache: "no-store", signal: AbortSignal.timeout(8000) }).then((r) => r.ok).catch(() => false), probeOrigin(HOSTING.oracleUrl), probeOrigin(HOSTING.vercelUrl)]);
  let master: Facts["chain"]["master"] = "unknown", curve: Facts["chain"]["curve"] = "none";
  if (cfg.curve) { curve = await chainState(cfg.curve); await new Promise((r) => setTimeout(r, 1200)); master = await chainState(cfg.master); }
  return { icon, gate: g, oracle: o.ok, vercel: v.ok, chain: { master, curve } };
}

/** Sends each problem to the owner at most once in 6 hours; "info" findings are only reported back, never sent. */
export async function runGuard(): Promise<{ facts: Facts; findings: Finding[]; notified: string[] }> {
  const facts = await gatherFacts();
  const findings = evaluate(facts);
  const notified: string[] = [];
  await ensureHostingTables();
  for (const f of findings.filter((x) => x.level === "problem")) {
    const n = Number(await prisma.$executeRawUnsafe(`INSERT INTO hosting_flags (key, value) VALUES ($1, now()::text) ON CONFLICT (key) DO UPDATE SET value=now()::text, updated_at=now() WHERE hosting_flags.updated_at < now() - interval '6 hours'`, `guard:${f.key}`));
    if (n > 0) { await notifyOwner(`🛡 حارس ZNBt\n${f.text}`); notified.push(f.key); }
  }
  return { facts, findings, notified };
}
