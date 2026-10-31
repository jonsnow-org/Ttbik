// LIVE timing of a Nova TASK (not just a reply) against the REAL coder Studio (run only by .github/workflows/nova-task-live.yml).
// Drives the production handler with a fake Telegram bot and a throwaway in-memory database, sends one task message and prints a timeline:
// every task event and every message the bot would have sent, with seconds since the request. Nothing is sent to Telegram.
import { handleCoderSections } from "@/lib/coderSections";
import { fakeBot } from "../coderFakes";
import { pgDb } from "../pgDb";

const botRow = { id: "bot1", token: "T", webhookSecret: "whs", isActive: true, template: "NOVA_BOT" } as any;
jest.setTimeout(3_300_000);
(process.env as any).NODE_ENV = "production";
const TEXT = process.env.PROBE_TEXT || "اقرأ المستودع jonsnow-org/Ttbik على GitHub واشرح بنيته في فقرة قصيرة";
const LIMIT_S = Number(process.env.PROBE_LIMIT_S || 1800);

test("a repository-reading task finishes, with a timeline", async () => {
  process.env.SUPER_ADMIN_TELEGRAM_ID = "4242";
  process.env.CODER_TOKEN_KEY = "live-test";
  const db: any = pgDb();
  const { bot, sent } = fakeBot();
  const t0 = Date.now();
  const stamp: { s: number; text: string }[] = [];
  let seen = 0;
  await handleCoderSections(bot, botRow, { message: { chat: { id: 4242 }, from: { id: 4242, first_name: "Owner" }, text: TEXT } }, db);
  let done = false;
  while (Date.now() - t0 < LIMIT_S * 1000 && !done) {
    await new Promise((r) => setTimeout(r, 2000));
    while (seen < sent.length) { stamp.push({ s: Math.round((Date.now() - t0) / 1000), text: String(sent[seen].text || "").slice(0, 160) }); seen++; }
    const ev = await db.query(`SELECT kind FROM coder_task_events ORDER BY id DESC LIMIT 1`);
    done = ev.length > 0 && ["done", "failed"].includes(String(ev[0].kind));
  }
  const events = await db.query(`SELECT kind, text FROM coder_task_events ORDER BY id`);
  console.log("TASK_SECONDS", Math.round((Date.now() - t0) / 1000), "finished=" + done);
  console.log("TASK_MESSAGES", JSON.stringify(stamp));
  console.log("TASK_EVENTS", JSON.stringify(events.map((e: any) => ({ k: e.kind, t: String(e.text || "").slice(0, 120) }))));
  expect(done).toBe(true);
});
