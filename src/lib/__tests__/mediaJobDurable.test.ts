// Owner 2026-11-05 live test: "media works in the tests but always fails in the bot; sometimes only a picture or a sound, never a clip".
// The cause was structural: the whole media path ran inside one 60 s Telegram webhook leg (the prompt router alone can take ~65 s, a real CPU clip
// takes minutes), so a video could never finish. These tests prove the fix: a media request is a DURABLE job on the run, carried across the same
// continuation legs a long answer uses, and a clip that outlives a leg is handed off (with its Studio job id) instead of being lost.
import { handleCoderSections, loadState } from "@/lib/coderSections";
import { fakeBot } from "./coderFakes";
import { b64, mp4Shell, wav, png, photoStudioFake } from "./mediaFixtures";
import { pgDb, resetPg } from "./pgDb";

jest.mock("dns/promises", () => ({ lookup: jest.fn(async () => [{ address: "93.184.216.34", family: 4 }]) }));

const OWNER = 4242;
const botRow = { id: "bot1", token: "T", webhookSecret: "whs", isActive: true, template: "NOVA_BOT" } as any;
const sse = (o: object) => `event: complete\ndata: [${JSON.stringify(JSON.stringify(o))}]\n`;
const wait = (ms = 50) => new Promise((r) => setTimeout(r, ms));
const until = async (f: () => Promise<boolean> | boolean, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await wait(40); } return false; };
const say = (text: string) => ({ message: { chat: { id: OWNER }, from: { id: OWNER }, text } });

/** A Studio that always answers `running` for a clip job (so the leg must hand off) and the given media otherwise. */
function studioNet(opts: { clip?: "running" | "done"; route?: string; media?: object; onContinue?: (chain: string) => void }) {
  let jobPolls = 0;
  const studio = photoStudioFake("coder", [Buffer.from("x")]);
  (global as any).fetch = jest.fn(async (url: string, init?: any) => {
    { const ph = studio(url, init); if (ph) return ph; }
    if (url.endsWith("/api/coder/continue")) { if (opts.onContinue) opts.onContinue(String(JSON.parse(init.body).chain)); return new Response("{}", { status: 202 }); }
    if (url.startsWith("https://media.test")) {
      if (url.includes("/call/v2/")) return new Response(JSON.stringify({ event_id: "e" }), { status: 200 });     // submit
      if (url.includes("/call/video_start/")) return new Response(sse({ type: "job", job: "j1" }), { status: 200 });
      if (url.includes("/call/job/")) {                                                                           // a clip poll
        jobPolls += 1;
        if (opts.clip === "running" || jobPolls < 2) return new Response(sse({ type: "running", phase: "sampling" }), { status: 200 });
        return new Response(sse(opts.media ?? { type: "video", b64: b64(mp4Shell()) }), { status: 200 });
      }
      return new Response(sse(opts.media ?? { type: "audio", b64: b64(wav("tone")) }), { status: 200 });           // speech / image read
    }
    if (url.includes("/gradio_api/call/v2/")) return new Response(JSON.stringify({ event_id: "e1" }), { status: 200 });
    if (url.includes("/gradio_api/call/")) return new Response(sse({ type: "done", job: "j", text: opts.route ?? "CHAT", tool_calls: [] }), { status: 200 });
    return new Response("{}", { status: 202 });
  });
}

beforeEach(async () => {
  await resetPg();
  process.env.OPEN_CODER_STUDIO_URL = "https://coder.test";
  process.env.NOVA_MEDIA_STUDIO_URL = "https://media.test";
  process.env.MODELSCOPE_API_TOKEN = "ms";
  process.env.CODER_POLL_MS = "5";
  process.env.SUPER_ADMIN_TELEGRAM_ID = String(OWNER);
  process.env.CODER_TOKEN_KEY = "test-key";
});

afterEach(() => { delete process.env.CODER_MEDIA_LEG_MS; });

describe("a media request is a durable job, not work inside the 60 s webhook", () => {
  it("a clip that outlives its leg is handed off WITH its Studio job id (the case that always failed in the bot)", async () => {
    process.env.CODER_MEDIA_LEG_MS = "8000";                       // a leg too short to wait for the clip: it must hand off, not give up
    const continued: string[] = [];
    studioNet({ clip: "running", route: "VIDEO 6 [wide] a lion running in the desert", onContinue: (c) => continued.push(c) });
    const { bot, api, sent } = fakeBot();
    (api as any).sendVideo = jest.fn();
    const d: any = pgDb();

    await handleCoderSections(bot, botRow, say("قم بتوليد فيديو اسد يركض في الصحراء"), d);
    expect(await until(() => continued.length === 1)).toBe(true);   // the leg handed the still-running clip on
    expect((api as any).sendVideo).not.toHaveBeenCalled();          // nothing delivered yet
    expect(sent.some((s) => /تعذّر/.test(s.text))).toBe(false);     // and no failure notice
    const st = await loadState(OWNER, d);
    expect(st.run?.media?.kind).toBe("video");
    expect(st.run?.media?.job).toBe("j1");                          // the Studio job id survived the handoff (the next leg resumes it)
    expect(st.run?.media?.phase).toBe("poll");
  }, 30000);

  it("a clip is delivered when the leg has the time (the job runs the whole path)", async () => {
    process.env.CODER_MEDIA_LEG_MS = "60000";
    studioNet({ clip: "done", route: "VIDEO 6 [wide] a lion running in the desert" });
    const { bot, api, sent } = fakeBot();
    (api as any).sendVideo = jest.fn(async () => ({ message_id: 1 }));
    const d: any = pgDb();

    await handleCoderSections(bot, botRow, say("قم بتوليد فيديو اسد يركض في الصحراء"), d);
    expect(await until(() => (api as any).sendVideo.mock.calls.length === 1)).toBe(true);
    // the run is cleared just after sendVideo resolves: wait for it instead of reading once (this raced and failed under a loaded full run)
    expect(await until(async () => (await loadState(OWNER, d)).run == null)).toBe(true);
    expect(sent.some((s) => /تعذّر/.test(s.text))).toBe(false);
  }, 30000);

  it("the webhook returns at once: the routing call and the generation happen in the background job", async () => {
    process.env.CODER_MEDIA_LEG_MS = "60000";
    studioNet({ route: "AUDIO مرحبا بكم في شام", media: { type: "audio", b64: b64(wav("tone")) } });
    const { bot, api } = fakeBot();
    (api as any).sendAudio = jest.fn(async () => ({ message_id: 1 }));
    const d: any = pgDb();
    await handleCoderSections(bot, botRow, say("حوّل هذا النص إلى صوت: مرحباً، هذا اختبار الصوت"), d);
    expect((api as any).sendAudio).not.toHaveBeenCalled();                          // the request already returned
    expect(await until(() => (api as any).sendAudio.mock.calls.length === 1)).toBe(true);
  }, 30000);

  it("a picture is delivered by the job too (the picture alone, no caption)", async () => {
    process.env.CODER_MEDIA_LEG_MS = "60000";
    const studio = photoStudioFake("coder", [await png("gradient", 256)]);
    (global as any).fetch = jest.fn(async (url: string, init?: any) => {
      { const ph = studio(url, init); if (ph) return ph; }
      if (url.endsWith("/api/coder/continue")) return new Response("{}", { status: 202 });
      if (url.includes("/gradio_api/call/v2/")) return new Response(JSON.stringify({ event_id: "e1" }), { status: 200 });
      if (url.includes("/gradio_api/call/")) return new Response(sse({ type: "done", job: "j", text: "IMAGE [tall] a white horse", tool_calls: [] }), { status: 200 });
      return new Response("{}", { status: 202 });
    });
    const { bot, api } = fakeBot();
    (api as any).sendPhoto = jest.fn(async () => ({ message_id: 1 }));
    const d: any = pgDb();
    await handleCoderSections(bot, botRow, say("قم بتوليد صورة فرس ابيض"), d);
    expect(await until(() => (api as any).sendPhoto.mock.calls.length === 1)).toBe(true);
    expect((api as any).sendPhoto.mock.calls[0][2]?.caption).toBeUndefined();      // never the raw English prompt as a caption
  }, 30000);

  it("a clip Studio without the background-job API still makes the clip through the legacy single call", async () => {
    process.env.CODER_MEDIA_LEG_MS = "60000";
    (global as any).fetch = jest.fn(async (url: string, init?: any) => {
      if (url.endsWith("/api/coder/continue")) return new Response("{}", { status: 202 });
      if (url.includes("/gradio_api/call/v2/video_start")) return new Response("not found", { status: 404 });      // an older Studio app
      if (url.includes("/gradio_api/call/v2/")) return new Response(JSON.stringify({ event_id: "e1" }), { status: 200 });
      if (url.includes("/gradio_api/call/video/")) return new Response(sse({ type: "video", b64: b64(mp4Shell()) }), { status: 200 });
      if (url.includes("/gradio_api/call/")) return new Response(sse({ type: "done", job: "j", text: "VIDEO 6 [wide] a lion running in the desert", tool_calls: [] }), { status: 200 });
      return new Response("{}", { status: 202 });
    });
    const { bot, api } = fakeBot();
    (api as any).sendVideo = jest.fn(async () => ({ message_id: 1 }));
    const d: any = pgDb();
    await handleCoderSections(bot, botRow, say("قم بتوليد فيديو اسد يركض في الصحراء"), d);
    expect(await until(() => (api as any).sendVideo.mock.calls.length === 1)).toBe(true);
  }, 30000);
});
