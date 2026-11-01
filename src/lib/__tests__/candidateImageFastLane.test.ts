// Owner's MiniCPM test 2026-11-01: «قم بتوليد صورة فتاة شقراء جميلة» waited 8 minutes on the slow chat model, then failed with HTTP 429.
// A clear picture request on a candidate now goes straight to THAT candidate's own image Studio: one card, one picture, no chat-model call.
import { saveState, startDonorTestTelegramTask } from "@/lib/coderSections";
import { fakeBot } from "./coderFakes";
import { photoStudioFake, b64, png } from "./mediaFixtures";
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
