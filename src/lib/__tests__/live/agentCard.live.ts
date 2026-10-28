// LIVE check of the progress card against the REAL Studios (only run by .github/workflows/agent-card-live.yml; never part of the normal test run).
// Nova: the production handler (handleCoderSections) with a fake Telegram bot + an in-memory database, the real coder Studios and a real (read-only) GitHub read.
// Sham v2: the real agent loop on the real Sham v2 Studio with the real GitHub tool, feeding the same card code the bot uses. Nothing is sent to Telegram.
import { handleCoderSections } from "@/lib/coderSections";
import { shamAgentRun, shamToolDefs } from "@/lib/shamAgent";
import { shamRunTool, type ShamCtx } from "@/lib/shamExec";
import { shamVariant } from "@/lib/shamStudio";
import { shamCardSteps, shamUnderstand } from "@/lib/novaBotLogic";
import { cardFinish, openCard, renderCard } from "@/lib/singleMessage";
import { fakeBot } from "../coderFakes";
import { pgDb } from "../pgDb";

jest.setTimeout(900000);
(process.env as any).NODE_ENV = "production";
const REPO = process.env.PROBE_REPO || "jonsnow-org/Ttbik";
const botRow = { id: "bot1", token: "T", webhookSecret: "whs", isActive: true, template: "NOVA_BOT" } as any;
const stamp = (t0: number) => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;

test("Nova: the card shows the model's own line and real steps; the answer replaces it in the same message", async () => {
  process.env.SUPER_ADMIN_TELEGRAM_ID = "4242"; process.env.CODER_TOKEN_KEY = "live-test"; process.env.CODER_GITHUB_TOKEN = process.env.PROBE_GH_TOKEN || process.env.CODER_GITHUB_TOKEN || "";
  process.env.CODER_CARD_GAP_MS = "0";
  const db: any = pgDb();
  const { bot, sent, edits } = fakeBot();
  const log: string[] = [];
  const t0 = Date.now();
  const seen = new Set<string>();
  const orig = (bot.api.editMessageText as any);
  bot.api.editMessageText = jest.fn(async (...a: any[]) => { const text = String(a[2]); if (!seen.has(text)) { seen.add(text); log.push(`--- edit ${stamp(t0)}\n${text}`); } return orig(...a); }) as any;
  const first = bot.api.sendMessage;
  bot.api.sendMessage = jest.fn(async (...a: any[]) => { log.push(`--- send ${stamp(t0)}\n${String(a[1]).slice(0, 600)}`); return (first as any)(...a); }) as any;
  await handleCoderSections(bot, botRow, { message: { chat: { id: 4242 }, from: { id: 4242, first_name: "Owner" }, text: `اقرأ الملف AGENTS.md في المستودع ${REPO} ولخّصه في سطرين` } }, db);
  const t = Date.now();
  while (Date.now() - t < 600000 && !(sent.length === 1 && !/📋/.test(sent[0].text) && sent[0].text.length > 20)) await new Promise((r) => setTimeout(r, 1000));
  console.log("NOVA_CARD_LOG\n" + log.join("\n"));
  console.log("NOVA_FINAL", JSON.stringify({ messages: sent.length, text: sent.map((s) => s.text.slice(0, 400)), edits: edits.length, secs: Math.round((Date.now() - t0) / 1000) }));
  expect(sent).toHaveLength(1);
  expect(sent[0].text).not.toMatch(/📋/);
  expect(log.some((l) => /قراءة ملف|قراءة ملفات|مسح المستودع|استعراض/.test(l))).toBe(true);   // a real step was shown
  expect(log.every((l) => !/فهمت طلبك/.test(l))).toBe(true);
});

test("Sham v2: understanding line from the model, real steps from the agent loop, answer replaces the card", async () => {
  const { bot, sent } = fakeBot();
  const t0 = Date.now();
  const log: string[] = [];
  const request = `اقرأ الملف AGENTS.md من المستودع ${REPO} ولخّصه في سطرين`;
  const ctx = { chatId: 4242, db: { exec: async () => undefined, query: async () => [] }, githubToken: process.env.PROBE_GH_TOKEN || process.env.CODER_GITHUB_TOKEN || "", chatKey: "sham:4242", runId: "sham-4242", owner: true } as unknown as ShamCtx;
  const snap = () => { const m = sent[0]?.text; if (m && log[log.length - 1] !== m) log.push(`--- ${stamp(t0)}\n${m}`); };
  await shamVariant.run("v2", async () => {
    const card = await openCard(bot, 4242, request, { understand: shamUnderstand(request) });
    const steps = shamCardSteps(bot, 4242, card);
    const timer = setInterval(snap, 400);
    snap();
    const r = await shamAgentRun({ text: request, ctx, tools: shamToolDefs(Boolean(ctx.githubToken)), budgetMs: 240000, askMs: 120000, maxNew: 200, onStep: steps, exec: (c, x) => shamRunTool(c, x) });
    clearInterval(timer);
    snap();
    const text = r.kind === "text" ? r.text : r.kind === "ask" ? r.question : `(${r.kind})`;
    await cardFinish(bot, 4242, card, text, async (p) => { await bot.api.sendMessage(4242, p); });
    log.push(`--- final ${stamp(t0)}\n${sent[0]?.text}`);
    console.log("SHAM_RESULT", JSON.stringify({ kind: r.kind, used: r.used, steps: r.steps }));
  });
  console.log("SHAM_CARD_LOG\n" + log.join("\n"));
  expect(sent).toHaveLength(1);
  expect(log.some((l) => /جاري التفكير/.test(l))).toBe(true);
  expect(log.every((l) => !/فهمت طلبك/.test(l))).toBe(true);
  void renderCard;
});
