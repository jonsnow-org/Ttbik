// Sham Pro live repeat probe (read-only): runs the bot's REAL Sham Pro round (shamAgentRun, as novaBotLogic calls it) against the live Studio with several
// different questions, as the owner (T-LDM on) and as an ordinary user (T-LDM off), and fails when two different questions get (nearly) the same reply.
// Tools: only read tools run (web / GitHub reads); any write is refused here. Needs MODELSCOPE_API_TOKEN. Run: npx tsx scripts/sham-pro/live-repeat.ts
import { shamAgentRun } from "@/lib/shamAgent";
import { shamModeCtx, shamTldmSession, shamVariant } from "@/lib/shamStudio";
import { shamRunTool, shamTools, type ShamCtx } from "@/lib/shamExec";

const QUESTIONS = (process.env.ASK || "").split("|").map((q) => q.trim()).filter(Boolean);
const QS = QUESTIONS.length ? QUESTIONS : ["ما عاصمة فرنسا؟", "اشرح لي التمثيل الضوئي باختصار", "كم يساوي 17 ضرب 3؟", "اكتب بيتاً من الشعر عن البحر", "ما الفرق بين بايثون وجافاسكربت؟", "من أنت؟", "اكتب دالة بايثون تعكس نصاً"];
const READ = new Set(["web_search", "fetch_page", "deep_research"]);

function ratio(a: string, b: string): number {
  if (!a || !b) return 0;
  const grams = (s: string) => { const m = new Map<string, number>(); for (let i = 0; i < s.length - 2; i++) { const g = s.slice(i, i + 3); m.set(g, (m.get(g) || 0) + 1); } return m; };
  const A = grams(a), B = grams(b);
  let common = 0, total = 0;
  A.forEach((v, k) => { common += Math.min(v, B.get(k) || 0); total += v; });
  B.forEach((v) => { total += v; });
  return total ? (2 * common) / total : 0;
}

async function run(label: string, owner: boolean, tldm: boolean): Promise<number> {
  console.log(`\n===== ${label} (owner=${owner}, tldm=${tldm}) =====`);
  const chatId = 900000000 + Math.floor(Math.random() * 1000000);
  const ctx = { chatId, db: null as never, githubToken: null, chatKey: `probe-${chatId}`, runId: `probe-${chatId}`, modelId: "sham_v2", owner } as ShamCtx;
  const history: { q: string; a: string }[] = [];
  const answers: string[] = [];
  for (const q of QS) {
    const t0 = Date.now();
    let streamed = "";
    const events: string[] = [];
    const r = await shamVariant.run("v2", () => shamModeCtx.run({ tldm } as never, () => shamTldmSession.run(`tldm-sham_v2-${chatId}`, () => shamAgentRun({
      text: q, history: history.slice(-4), ctx, tools: shamTools(false, false), budgetMs: 170000, askMs: 150000, maxNew: 512, mode: { tldm } as never, continuable: false,
      onDelta: (p) => { streamed += p; }, onEvent: (k, t) => { events.push(`${k}: ${t.slice(0, 120)}`); },
      exec: async (call, c) => READ.has(call.function.name) ? shamRunTool(call, c) : `error: ${call.function.name} is not run in the live probe (read-only)`,
    })))).catch((e) => ({ kind: "error", text: String(e?.message || e) } as never));
    const res = r as { kind: string; text?: string; reply?: { text?: string; type?: string }; question?: string };
    const text = String(res.text || res.question || res.reply?.text || "").trim();
    console.log(`\nQ: ${q}\nkind=${res.kind} (${Math.round((Date.now() - t0) / 1000)}s)${events.length ? `\n  events: ${events.slice(0, 6).join(" | ")}` : ""}\nA: ${JSON.stringify(text.slice(0, 400))}${streamed && streamed.trim() !== text ? `\n  streamed: ${JSON.stringify(streamed.slice(0, 200))}` : ""}`);
    answers.push(text);
    history.push({ q, a: text });
  }
  let bad = 0;
  for (let i = 0; i < answers.length; i++) for (let j = i + 1; j < answers.length; j++) {
    const s = ratio(answers[i], answers[j]);
    if (s > 0.8) { bad++; console.log(`  REPEAT [${label}] Q${i + 1} vs Q${j + 1}: similarity ${s.toFixed(2)}`); }
  }
  const empty = answers.filter((a) => !a).length;
  if (empty) console.log(`  EMPTY replies [${label}]: ${empty}`);
  return bad + empty;
}

(async () => {
  if (!(process.env.MODELSCOPE_API_TOKEN || "").trim()) { console.log("no MODELSCOPE_API_TOKEN — no probe"); return; }
  const which = (process.env.PROBE_AS || "owner,user").split(",");
  let bad = 0;
  if (which.includes("owner")) bad += await run("owner", true, true);
  if (which.includes("user")) bad += await run("user", false, false);
  console.log(`\nproblems: ${bad}`);
  process.exit(bad ? 1 : 0);
})();
