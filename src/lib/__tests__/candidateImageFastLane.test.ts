// Owner's MiniCPM test 2026-11-01: «قم بتوليد صورة فتاة شقراء جميلة» waited 8 minutes on the slow chat model, then failed with HTTP 429.
// A clear picture request on a candidate now goes straight to THAT candidate's own image Studio: one card, one picture, no chat-model call.
import { saveState, startDonorTestTelegramTask } from "@/lib/coderSections";
import { fakeBot } from "./coderFakes";
import { photoStudioFake, b64, png, mp4Shell } from "./mediaFixtures";
import { pgDb, resetPg } from "./pgDb";

jest.mock("dns/promises", () => ({ lookup: jest.fn(async () => [{ address: "93.184.216.34", family: 4 }]) }));
const OWNER = 4242;
const wait = (ms = 50) => new Promise((r) => setTimeout(r, ms));

beforeEach(async () => {
  await resetPg();
  process.env.MODELSCOPE_API_TOKEN = "ms"; process.env.SUPER_ADMIN_TELEGRAM_ID = String(OWNER); process.env.CODER_TOKEN_KEY = "k";
});

it("a picture request on MiniCPM is made by its own image Studio and sent; the chat Studio is never asked", async () => {
  const db: any = pgDb();
  await saveState(OWNER, { mode: "coder", think: false, messages: [], notes: "", inbox: [], run: null, model: "minicpmo45" } as any, db);
  const good = Buffer.from(b64(await png("gradient", 256)), "base64");
  const studio = photoStudioFake("minicpmo45", [good]);
  const urls: string[] = [];
  (global as any).fetch = jest.fn(async (url: string, init?: any) => { urls.push(url); return studio(url, init) || new Response("{}", { status: 500 }); });
  const { bot, api } = fakeBot();
  (api as any).sendPhoto = jest.fn(async () => ({ message_id: 1 }));
  await startDonorTestTelegramTask(bot, OWNER, "قم بتوليد صورة فتاة حسناء", "bot1", undefined, db, globalThis.fetch, "telegram", "minicpmo45");
  for (let i = 0; i < 100 && !(api as any).sendPhoto.mock.calls.length; i++) await wait(50);
  expect((api as any).sendPhoto).toHaveBeenCalledTimes(1);
  expect(urls.every((u) => u.startsWith(studio.base))).toBe(true);                        // only MiniCPM's own image Studio was called
  expect(urls.some((u) => u.includes("donor") || u.includes("chat_start"))).toBe(false);
});

it("a video request on Gemma is made by Gemma's OWN media Studio (never Nova's) and sent", async () => {
  const db: any = pgDb();
  process.env.NOVA_MEDIA_STUDIO_URL = "https://nova-media.test";
  await saveState(OWNER, { mode: "coder", think: false, messages: [], notes: "", inbox: [], run: null, model: "gemma4-e4b" } as any, db);
  const urls: string[] = [];
  const clip = b64(mp4Shell(6000));
  (global as any).fetch = jest.fn(async (url: string, init?: any) => {
    urls.push(url);
    if (url.includes("sham-donor-gemma4-e4b-media") && init?.method === "POST") return new Response('{"event_id":"v1"}', { status: 200 });
    if (url.includes("sham-donor-gemma4-e4b-media")) return new Response(`event: complete\ndata: ${JSON.stringify([JSON.stringify({ type: "video", b64: clip })])}\n\n`, { status: 200 });
    return new Response("{}", { status: 500 });
  });
  const { bot, api } = fakeBot();
  (api as any).sendVideo = jest.fn(async () => ({ message_id: 2 }));
  await startDonorTestTelegramTask(bot, OWNER, "قم بتوليد فديو فتاة ترقص 5 ثوان", "bot1", undefined, db, globalThis.fetch, "telegram", "gemma4-e4b");
  for (let i = 0; i < 100 && !(api as any).sendVideo.mock.calls.length; i++) await wait(50);
  expect((api as any).sendVideo).toHaveBeenCalledTimes(1);
  expect(urls.every((u) => u.includes("sham-donor-gemma4-e4b-media"))).toBe(true);
});
