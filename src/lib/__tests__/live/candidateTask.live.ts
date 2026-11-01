// LIVE pre-flight of one candidate model through the production chat handler (run only by .github/workflows/candidate-task-live.yml).
// Fake Telegram bot + throwaway in-memory database, REAL candidate Studio: proves the whole path the owner will use from the bot (readiness probe, durable job, polling,
// hand-off legs, delivery) and prints a timeline of every event and message with seconds since the request. Nothing is sent to Telegram.
import { drive, handleCoderSections, later, saveState } from "@/lib/coderSections";
import { fakeBot } from "../coderFakes";
import { pgDb } from "../pgDb";

const botRow = { id: "bot1", token: "T", webhookSecret: "whs", isActive: true, template: "NOVA_BOT" } as any;
jest.setTimeout(3_300_000);
(process.env as any).NODE_ENV = "production";
const MODEL = process.env.PROBE_MODEL || "gemma4-e4b";
const TEXT = process.env.PROBE_TEXT || "اشرح لي في ثلاثة أسطر ما هو GitHub Actions";
const LIMIT_S = Number(process.env.PROBE_LIMIT_S || 1500);

test("a candidate answers through the bot path", async () => {
  process.env.SUPER_ADMIN_TELEGRAM_ID = "4242";
  process.env.CODER_TOKEN_KEY = "live-test";
  const db: any = pgDb();
  await saveState(4242, { mode: "coder", think: false, messages: [], notes: "", inbox: [], run: null, model: MODEL } as any, db);
  const { bot, sent } = fakeBot();
  const t0 = Date.now();
  let seen = 0;
  let lastEvent = 0;
  let done = false;
  const live = (line: string) => process.stderr.write(`CAND_LIVE ${Math.round((Date.now() - t0) / 1000)}s ${line}\n`);
  const realFetch = global.fetch;
  global.fetch = (async (input: any, init?: any) => {
    const url = String(input);
    if (url.endsWith("/api/coder/donor-continue")) {                 // the hand-off to the next leg runs in-process here
      const b = JSON.parse(String(init?.body || "{}"));
      const chain = JSON.parse(Buffer.from(b.chain, "base64url").toString("utf8"));
      const { continueDonorRun } = await import("@/lib/coderSections");
      later(() => continueDonorRun({ ...botRow, token: "T" } as any, Number(b.chatId), chain, db));
      return new Response("{}", { status: 202 });
    }
    return realFetch(input, init);
  }) as any;
  await handleCoderSections(bot, botRow, { message: { chat: { id: 4242 }, from: { id: 4242, first_name: "Owner" }, text: TEXT } }, db);
  while (Date.now() - t0 < LIMIT_S * 1000 && !done) {
    await new Promise((r) => setTimeout(r, 2000));
    while (seen < sent.length) { live("MESSAGE " + String(sent[seen].text || "").slice(0, 240).replace(/\n/g, " / ")); seen++; }
    const rows = await db.query(`SELECT id, kind, text FROM coder_task_events WHERE id > $1 ORDER BY id`, lastEvent);
    for (const e of rows) { lastEvent = Number(e.id); live("EVENT " + e.kind + " " + String(e.text || "").slice(0, 200).replace(/\n/g, " / ")); if (["done", "failed"].includes(String(e.kind))) done = true; }
  }
  global.fetch = realFetch;
  console.log("CAND_SECONDS", Math.round((Date.now() - t0) / 1000), "finished=" + done, "model=" + MODEL);
  expect(done).toBe(true);
});
