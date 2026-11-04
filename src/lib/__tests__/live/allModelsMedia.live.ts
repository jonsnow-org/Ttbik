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
jest.setTimeout(20_400_000);   // a run of several long clips (up to 2 min each) on a CPU Studio; the job itself stops at 350 min
(process.env as any).NODE_ENV = "production";
const OUT = process.env.PROBE_OUT || "/tmp";
const MODELS = (process.env.PROBE_MODELS || "coder,lfm25,sham_v2,qwen35-9b,gemma4-e4b,minicpmo45").split(",");
const IMAGE = process.env.PROBE_IMAGE || "قم بتوليد صورة فتاة حسناء";
const VIDEO = process.env.PROBE_VIDEO || "قم بتوليد فديو فتاة ترقص 10 ثوان";
const AUDIO = process.env.PROBE_AUDIO || "حوّل هذا النص إلى صوت: مرحباً، هذا اختبار الصوت";
const CHAT = process.env.PROBE_CHAT || "مرحبا";
const KINDS = (process.env.PROBE_KINDS || "image,video").split(",");
const LIMIT = { image: 420_000, video: Number(process.env.PROBE_VIDEO_LIMIT_MS || 600_000), audio: 300_000, chat: 300_000 } as const;
// owner 2026-11-04 3:44 AM: «مرحبا» was answered with the media-failure note. A greeting must get a normal reply: no file, no "not sent" note, no claim.
const MEDIA_NOTE = /لم يُرسل|لم أُرسل|تعذّر إنشاء|ها هي الصورة|أرسلت (?:لك )?(?:الصورة|المقطع|الفيديو)/;     // a 1-2 min clip on CPU needs far longer than 10 min

async function once(model: string, kind: "image" | "video" | "audio" | "chat", text: string, tag = ""): Promise<string> {
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
    fs.writeFileSync(path.join(OUT, `${model}${tag}-${kind}.${ext}`), buf);
    return { message_id: 9 };
  };
  (api as any).sendPhoto = grab("photo", "png");
  (api as any).sendVideo = grab("video", "mp4");
  (api as any).sendAudio = grab("audio", "wav");
  (api as any).sendVoice = grab("audio", "ogg");
  const t0 = Date.now();
  try {
    if (model === "coder" || model === "lfm25") await handleCoderSections(bot, botRow, { message: { chat: { id: chat }, from: { id: chat, first_name: "Owner" }, text } }, db);
    else if (model === "sham" || model === "sham_v2") await shamVariant.run(model === "sham" ? "v1" : "v2", () => shamMediaFastLane(bot, chat, text, "bot1"));
    else await startDonorTestTelegramTask(bot, chat, text, "bot1", undefined, db, globalThis.fetch, "telegram", model as any);
  } catch (e) { return `${model} ${kind}: EXCEPTION ${String((e as Error)?.message || e).slice(0, 200)}`; }
  const limit = LIMIT[kind];
  if (kind === "chat") {
    const final = () => sent.filter((s) => s.text && !/جاري|🕒|⏳/.test(s.text));
    while (Date.now() - t0 < limit && !final().length && !got.length) await new Promise((r) => setTimeout(r, 1500));
    const secs = Math.round((Date.now() - t0) / 1000);
    const reply = final().map((s) => s.text.replace(/\n/g, " / ")).join(" || ").slice(0, 300);
    if (got.length) return `${model} chat: BAD sent a ${got[0].kind} for a greeting in ${secs}s`;
    if (!reply) return `${model} chat: NO REPLY after ${secs}s`;
    return `${model} chat: ${MEDIA_NOTE.test(reply) ? "BAD media note" : "OK"} in ${secs}s: ${reply}`;
  }
  while (Date.now() - t0 < limit && !got.length) {
    await new Promise((r) => setTimeout(r, 1500));
    if (sent.some((s) => /تعذّر|لم أستطع|لم يتم|غير مفعّل|not|failed/i.test(s.text) && !/جاري|🕒|⏳/.test(s.text))) break;
  }
  const secs = Math.round((Date.now() - t0) / 1000);
  // phase timing: when the model's routing answer arrived (the "info" event carries the generator prompt) and when the run ended
  const evs = await db.query(`SELECT kind, created_at FROM coder_task_events ORDER BY id`).catch(() => [] as any[]);
  for (const e of evs as any[]) process.stderr.write(`ALLMEDIA_PHASE ${model} ${kind} ${e.kind} at ${Math.round((new Date(e.created_at).getTime() - t0) / 1000)}s\n`);
  if (got.length) return `${model} ${kind}: OK ${got[0].kind} ${got[0].bytes} bytes in ${secs}s`;
  return `${model} ${kind}: NOTHING SENT after ${secs}s; chat shows: ${sent.map((s) => s.text.replace(/\n/g, " / ").slice(0, 260)).join(" || ") || "(no message)"}`;
}

test("every model: a picture and a video request", async () => {
  const lines: string[] = [];
  // PROBE_VIDEO may hold several requests separated by "||" (one per duration): they run one after another on the model's own Studio (never in parallel: a 2 vCPU Studio runs one clip at a time)
  const videos = VIDEO.split("||").map((x) => x.trim()).filter(Boolean);
  for (const m of MODELS) for (const k of KINDS) {
    const asks = k === "video" ? videos : [k === "image" ? IMAGE : k === "chat" ? CHAT : AUDIO];
    for (let i = 0; i < asks.length; i++) {
      const tag = asks.length > 1 ? "-" + (i + 1) : "";
      const line = await once(m, k as "image" | "video" | "audio" | "chat", asks[i], tag);
      lines.push(line + (tag ? ` [${asks[i]}]` : ""));
      process.stderr.write("ALLMEDIA " + lines[lines.length - 1] + "\n");
    }
  }
  console.log("ALLMEDIA_SUMMARY\n" + lines.join("\n"));
});
