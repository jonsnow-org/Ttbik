// LIVE check of picture / video requests for EVERY model, through the production entry points of the bot, against the REAL Studios (run only by
// .github/workflows/all-models-media-live.yml). Prints one line per model: what was sent (photo / video bytes), the seconds it took, or the exact text the user would have seen.
import fs from "fs";
import path from "path";
import { handleCoderSections, saveState, startDonorTestTelegramTask } from "@/lib/coderSections";
import { shamMediaFastLane } from "@/lib/novaBotLogic";
import { shamVariant } from "@/lib/shamStudio";
import { fakeBot } from "../coderFakes";
import { pgDb } from "../pgDb";

const botRow = { id: "bot1", token: "T", webhookSecret: "whs", isActive: true, template: "NOVA_BOT" } as any;
jest.setTimeout(3_000_000);
(process.env as any).NODE_ENV = "production";
const OUT = process.env.PROBE_OUT || "/tmp";
const MODELS = (process.env.PROBE_MODELS || "coder,sham,sham_v2,qwen35-9b,gemma4-e4b,minicpmo45").split(",");
const IMAGE = process.env.PROBE_IMAGE || "قم بتوليد صورة فتاة حسناء";
const VIDEO = process.env.PROBE_VIDEO || "قم بتوليد فديو فتاة ترقص 5 ثوان";
const KINDS = (process.env.PROBE_KINDS || "image,video").split(",");
const LIMIT = { image: 420_000, video: 600_000 } as const;

async function once(model: string, kind: "image" | "video", text: string): Promise<string> {
  process.env.SUPER_ADMIN_TELEGRAM_ID = "4242";
  process.env.CODER_TOKEN_KEY = "live-test";
  const db: any = pgDb();
  const chat = 4242;
  await db.exec("DELETE FROM coder_tasks").catch(() => null);
  await saveState(chat, { mode: model === "sham" || model === "sham_v2" ? "sham" : "coder", think: false, messages: [], notes: "", inbox: [], run: null, model } as any, db);
  const { bot, api, sent } = fakeBot();
  const got: { kind: string; bytes: number }[] = [];
  const grab = (k: string, ext: string) => async (_c: number, file: any) => {
    const buf: Buffer = Buffer.isBuffer(file?.fileData) ? file.fileData : Buffer.alloc(0);
    got.push({ kind: k, bytes: buf.length });
    fs.writeFileSync(path.join(OUT, `${model}-${kind}.${ext}`), buf);
    return { message_id: 9 };
  };
  (api as any).sendPhoto = grab("photo", "png");
  (api as any).sendVideo = grab("video", "mp4");
  const t0 = Date.now();
  try {
    if (model === "coder") await handleCoderSections(bot, botRow, { message: { chat: { id: chat }, from: { id: chat, first_name: "Owner" }, text } }, db);
    else if (model === "sham" || model === "sham_v2") await shamVariant.run(model === "sham" ? "v1" : "v2", () => shamMediaFastLane(bot, chat, text, "bot1"));
    else await startDonorTestTelegramTask(bot, chat, text, "bot1", undefined, db, globalThis.fetch, "telegram", model as any);
  } catch (e) { return `${model} ${kind}: EXCEPTION ${String((e as Error)?.message || e).slice(0, 200)}`; }
  const limit = LIMIT[kind];
  while (Date.now() - t0 < limit && !got.length) {
    await new Promise((r) => setTimeout(r, 1500));
    if (sent.some((s) => /تعذّر|لم أستطع|لم يتم|غير مفعّل|not|failed/i.test(s.text) && !/جاري|🕒|⏳/.test(s.text))) break;
  }
  const secs = Math.round((Date.now() - t0) / 1000);
  if (got.length) return `${model} ${kind}: OK ${got[0].kind} ${got[0].bytes} bytes in ${secs}s`;
  return `${model} ${kind}: NOTHING SENT after ${secs}s; chat shows: ${sent.map((s) => s.text.replace(/\n/g, " / ").slice(0, 260)).join(" || ") || "(no message)"}`;
}

test("every model: a picture and a video request", async () => {
  const lines: string[] = [];
  for (const m of MODELS) for (const k of KINDS) {
    const line = await once(m, k as "image" | "video", k === "image" ? IMAGE : VIDEO);
    lines.push(line);
    process.stderr.write("ALLMEDIA " + line + "\n");
  }
  console.log("ALLMEDIA_SUMMARY\n" + lines.join("\n"));
});
