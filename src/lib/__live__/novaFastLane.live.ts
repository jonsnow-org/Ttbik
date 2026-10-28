// LIVE check of Nova's chat fast lane against the REAL Studios (run only by .github/workflows/nova-fastlane-live.yml; never part of the normal test run).
// It drives the production handler (handleCoderSections) with a fake Telegram bot and a throwaway in-memory database, but real English-prompt translation on a coder Studio
// and real image generation on Nova's media Studio, then checks the picture that would have been sent. Nothing is sent to Telegram.
import fs from "fs";
import path from "path";
import { handleCoderSections } from "@/lib/coderSections";
import { fakeBot } from "../__tests__/coderFakes";
import { pgDb } from "../__tests__/pgDb";

const botRow = { id: "bot1", token: "T", webhookSecret: "whs", isActive: true, template: "NOVA_BOT" } as any;
jest.setTimeout(900000);

test("'قم بتوليد صورة فرس ابيض' -> a real, non-blank picture, no caption, no 'unavailable' text", async () => {
  process.env.SUPER_ADMIN_TELEGRAM_ID = "4242";
  process.env.CODER_TOKEN_KEY = "live-test";
  const db: any = pgDb();
  const { bot, api, sent } = fakeBot();
  const photos: { bytes: number; caption?: string; at: number }[] = [];
  const out = process.env.PROBE_OUT || "/tmp";
  (api as any).sendPhoto = async (_c: number, file: any, extra: any) => {
    const buf: Buffer = await new Promise((res, rej) => { const parts: Buffer[] = []; const s = file.fileData; if (Buffer.isBuffer(s)) return res(s); rej(new Error("unexpected file")); void parts; });
    photos.push({ bytes: buf.length, caption: extra?.caption, at: Date.now() });
    fs.writeFileSync(path.join(out, "fastlane-white-horse.png"), buf);
    return { message_id: 1 };
  };
  const t0 = Date.now();
  await handleCoderSections(bot, botRow, { message: { chat: { id: 4242 }, from: { id: 4242, first_name: "Owner" }, text: "قم بتوليد صورة فرس ابيض" } }, db);
  const t = Date.now();
  while (Date.now() - t < 600000 && !photos.length && !sent.some((s) => /تعذّر/.test(s.text))) await new Promise((r) => setTimeout(r, 1000));
  console.log("LIVE_RESULT", JSON.stringify({ photos: photos.map((p) => ({ bytes: p.bytes, caption: p.caption ?? null, secs: Math.round((p.at - t0) / 1000) })), texts: sent.map((s) => s.text.slice(0, 120)) }));
  const ev = await db.query(`SELECT kind, text FROM coder_task_events ORDER BY id`);
  console.log("LIVE_EVENTS", JSON.stringify(ev));
  expect(photos.length).toBe(1);
  expect(photos[0].bytes).toBeGreaterThan(20000);
  expect(photos[0].caption).toBeUndefined();
  expect(sent.some((s) => /غير متاح|unavailable/i.test(s.text))).toBe(false);
});
