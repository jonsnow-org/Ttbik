// LIVE timing of a Nova TASK (not just a reply) against the REAL coder Studio (run only by .github/workflows/nova-task-live.yml).
// Drives the production handler with a fake Telegram bot and a throwaway in-memory database, sends one task message and prints a timeline:
// every task event and every message the bot would have sent, with seconds since the request. Nothing is sent to Telegram.
import { drive, handleCoderSections, later, resumeOrphan, saveState } from "@/lib/coderSections";
import { claimOrphanTasks } from "@/lib/coderTasks";
import { fakeBot } from "../coderFakes";
import { pgDb } from "../pgDb";

const botRow = { id: "bot1", token: "T", webhookSecret: "whs", isActive: true, template: "NOVA_BOT" } as any;
jest.setTimeout(3_300_000);
(process.env as any).NODE_ENV = "production";
const TEXT = process.env.PROBE_TEXT || "اقرأ المستودع jonsnow-org/Ttbik على GitHub واشرح بنيته في فقرة قصيرة";
const LIMIT_S = Number(process.env.PROBE_LIMIT_S || 1500);

test("a repository-reading task finishes, with a timeline", async () => {
  process.env.SUPER_ADMIN_TELEGRAM_ID = "4242";
  process.env.CODER_TOKEN_KEY = "live-test";
  const db: any = pgDb();
  const { bot, sent } = fakeBot();
  // The long-task handoff normally posts to the deployed site; here it continues in-process so the whole task runs inside this test.
  const realFetch = global.fetch;
  // PROBE_DROP_CONTINUE=1: the first hand-off is LOST (as when the server is replaced mid-task): the orphan sweep must find the silent run and resume it
  let dropLeft = process.env.PROBE_DROP_CONTINUE === "1" ? 1 : 0;
  let dropped = false;
  global.fetch = (async (input: any, init?: any) => {
    const url = String(input);
    if (url.endsWith("/api/coder/continue") && dropLeft > 0) {
      dropLeft--;
      dropped = true;
      process.stderr.write("TASK_LIVE dropped one hand-off (simulated disconnect)\n");
      return new Response("{}", { status: 202 });
    }
    if (url.endsWith("/api/coder/continue")) {
      const b = JSON.parse(String(init?.body || "{}"));
      const [who, ...rest] = String(b.chatId).split("#");
      later(() => drive(bot, botRow, Number(who), b.chain, db, 30000, rest.join("#")));
      return new Response("{}", { status: 202 });
    }
    return realFetch(input, init);
  }) as any;
  // PROBE_MODEL picks the engine model (coder = Nova, lfm25 = LFM2.5); each runs only on its own Studios
  if (process.env.PROBE_MODEL) await saveState(4242, { mode: "coder", think: false, messages: [], notes: "", inbox: [], run: null, model: process.env.PROBE_MODEL } as any, db);
  const t0 = Date.now();
  let seen = 0;
  await handleCoderSections(bot, botRow, { message: { chat: { id: 4242 }, from: { id: 4242, first_name: "Owner" }, text: TEXT } }, db);
  let done = false;
  let lastEvent = 0;
  let lastEventAt = Date.now();
  let resumed = 0;
  const live = (line: string) => process.stderr.write(`TASK_LIVE ${Math.round((Date.now() - t0) / 1000)}s ${line}\n`);
  while (Date.now() - t0 < LIMIT_S * 1000 && !done) {
    await new Promise((r) => setTimeout(r, 2000));
    while (seen < sent.length) { live("MESSAGE " + String(sent[seen].text || "").slice(0, 200).replace(/\n/g, " / ")); seen++; }
    const rows = await db.query(`SELECT id, kind, text FROM coder_task_events WHERE id > $1 ORDER BY id`, lastEvent);
    if (dropped && Date.now() - lastEventAt > 95000) {
      // what the every-minute tick does in production (runCoderTick → claimOrphanTasks → resumeOrphan)
      for (const o of await claimOrphanTasks(db, 90000)) if (await resumeOrphan(o.chatId, o.run_id, o.slot, botRow, db)) { resumed++; live("RESUMED " + o.run_id); }
      lastEventAt = Date.now();
    }
    for (const e of rows) { lastEvent = Number(e.id); lastEventAt = Date.now(); live("EVENT " + e.kind + " " + String(e.text || "").slice(0, 200).replace(/\n/g, " / ")); if (["done", "failed"].includes(String(e.kind))) done = true; }
  }
  console.log("TASK_SECONDS", Math.round((Date.now() - t0) / 1000), "finished=" + done, "dropped=" + dropped, "resumed=" + resumed);
  // long answers are delivered in Telegram-sized parts: no message may pass the 4096-character limit
  const tooLong = sent.filter((m: any) => String(m.text || "").length > 4096).length;
  console.log("TASK_MESSAGES", sent.length, "over4096=" + tooLong);
  expect(tooLong).toBe(0);
  if (dropped) expect(resumed).toBeGreaterThan(0);
  expect(done).toBe(true);
});
