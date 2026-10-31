// LIVE timing of a Nova TASK (not just a reply) against the REAL coder Studio (run only by .github/workflows/nova-task-live.yml).
// Drives the production handler with a fake Telegram bot and a throwaway in-memory database, sends one task message and prints a timeline:
// every task event and every message the bot would have sent, with seconds since the request. Nothing is sent to Telegram.
import { drive, handleCoderSections, later } from "@/lib/coderSections";
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
  global.fetch = (async (input: any, init?: any) => {
    const url = String(input);
    if (url.endsWith("/api/coder/continue")) {
      const b = JSON.parse(String(init?.body || "{}"));
      const [who, ...rest] = String(b.chatId).split("#");
      later(() => drive(bot, botRow, Number(who), b.chain, db, 30000, rest.join("#")));
      return new Response("{}", { status: 202 });
    }
    return realFetch(input, init);
  }) as any;
  const t0 = Date.now();
  let seen = 0;
  await handleCoderSections(bot, botRow, { message: { chat: { id: 4242 }, from: { id: 4242, first_name: "Owner" }, text: TEXT } }, db);
  let done = false;
  let lastEvent = 0;
  const live = (line: string) => process.stderr.write(`TASK_LIVE ${Math.round((Date.now() - t0) / 1000)}s ${line}\n`);
  while (Date.now() - t0 < LIMIT_S * 1000 && !done) {
    await new Promise((r) => setTimeout(r, 2000));
    while (seen < sent.length) { live("MESSAGE " + String(sent[seen].text || "").slice(0, 200).replace(/\n/g, " / ")); seen++; }
    const rows = await db.query(`SELECT id, kind, text FROM coder_task_events WHERE id > $1 ORDER BY id`, lastEvent);
    for (const e of rows) { lastEvent = Number(e.id); live("EVENT " + e.kind + " " + String(e.text || "").slice(0, 200).replace(/\n/g, " / ")); if (["done", "failed"].includes(String(e.kind))) done = true; }
  }
  console.log("TASK_SECONDS", Math.round((Date.now() - t0) / 1000), "finished=" + done);
  expect(done).toBe(true);
});
