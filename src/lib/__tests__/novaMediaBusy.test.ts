// 2026-10-28 15:33 live failure: Nova told the owner "the media Studio is not connected in this session" for «قم بتوليد صورة اسد». Never a model excuse:
// a busy Studio = the request waits in line (visible in the ONE message) and then the picture comes; media switched off / Studio off = a precise, deterministic answer.
import { handleCoderSections } from "@/lib/coderSections";
import { novaMediaUrl, novaMakeMedia, readMediaSse, DEFAULT_NOVA_MEDIA_URL } from "@/lib/novaMedia";
import { fakeBot } from "./coderFakes";
import { b64, png } from "./mediaFixtures";
import { pgDb, resetPg } from "./pgDb";

jest.mock("dns/promises", () => ({ lookup: jest.fn(async () => [{ address: "93.184.216.34", family: 4 }]) }));
const OWNER = 4242;
const botRow = { id: "bot1", token: "T", webhookSecret: "whs", isActive: true, template: "NOVA_BOT" } as any;
const sse = (o: object) => `event: complete\ndata: [${JSON.stringify(JSON.stringify(o))}]\n`;
const wait = (ms = 50) => new Promise((r) => setTimeout(r, ms));
beforeEach(async () => {
  await resetPg();
  process.env.OPEN_CODER_STUDIO_URL = "https://coder.test"; process.env.NOVA_MEDIA_STUDIO_URL = "https://media.test";
  process.env.MODELSCOPE_API_TOKEN = "ms"; process.env.CODER_POLL_MS = "5"; process.env.SUPER_ADMIN_TELEGRAM_ID = String(OWNER); process.env.CODER_TOKEN_KEY = "k";
});

function net(mediaAnswers: object[]) {
  let i = 0;
  (global as any).fetch = jest.fn(async (url: string) => {
    if (url.endsWith("/api/coder/continue")) return new Response("{}", { status: 202 });
    if (url.startsWith("https://media.test")) return url.includes("/call/v2/") ? new Response(JSON.stringify({ event_id: "m" })) : new Response(sse(mediaAnswers[Math.min(i++, mediaAnswers.length - 1)]));
    if (url.includes("/gradio_api/call/v2/")) return new Response(JSON.stringify({ event_id: "e" }));
    if (url.includes("/gradio_api/call/")) return new Response(sse({ type: "done", job: "j", text: "a lion", tool_calls: [] }));
    return new Response("{}", { status: 202 });
  });
}
const say = (text: string) => ({ message: { chat: { id: OWNER }, from: { id: OWNER }, text } });

describe("Nova media Studio SSE streaming", () => {
  it("returns the first complete media result while the Studio stream remains open", async () => {
    const encoder = new TextEncoder();
    const line = `data: ["{\"type\":\"audio\",\"b64\":\"QUJD\"}"]\n`;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("event: generating\n"));
        controller.enqueue(encoder.encode(line));
        // Deliberately keep the stream open, like a slow Studio which has already produced its result.
      },
      cancel() { cancelled = true; },
    });
    const response = {
      body,
      text: async () => { throw new Error("must not wait for EOF"); },
    } as unknown as Response;

    await expect(readMediaSse(response)).resolves.toEqual({ type: "audio", b64: "QUJD" });
    expect(cancelled).toBe(true);
  });
});

describe("Nova media Studio busy / off", () => {
  it("busy twice, then the picture: one message while waiting, the picture sent, the card gone, no excuse text", async () => {
    net([{ type: "busy" }, { type: "busy" }, { type: "image", b64: b64(await png("gradient", 256)) }]);
    const { bot, api, sent } = fakeBot();
    (api as any).sendPhoto = jest.fn(async () => ({ message_id: 1 }));
    const d: any = pgDb();
    await handleCoderSections(bot, botRow, say("قم بتوليد صورة اسد"), d);
    expect(sent.length).toBe(1);
    expect(sent[0].text).toMatch(/^🕒 .*\n💬 /);                                  // the one message, at once (date + time, the received line; no canned echo)
    expect(sent[0].text).not.toMatch(/فهمت طلبك/);
    for (let i = 0; i < 100 && !(api as any).sendPhoto.mock.calls.length; i++) await wait(50);
    expect((api as any).sendPhoto).toHaveBeenCalledTimes(1);
    await wait(100);
    expect(sent.some((s) => /غير متصل|not connected|غير متاح/.test(s.text))).toBe(false);
    expect(sent).toHaveLength(0);                                         // the card was removed; the picture is the reply
  });
  it("busy for good: a precise reason written INTO the one message (never the model's excuse)", async () => {
    net([{ type: "busy" }]);
    const { bot, sent } = fakeBot();
    const d: any = pgDb();
    process.env.NODE_ENV = "test";
    await handleCoderSections(bot, botRow, say("قم بتوليد صورة اسد"), d);
    for (let i = 0; i < 100 && !sent.some((s) => /تعذّر إنشاء الصورة/.test(s.text)); i++) await wait(50);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toMatch(/تعذّر إنشاء الصورة/);
    expect(sent[0].text).toMatch(/مشغول/);
  }, 30000);
  it("a legacy stored media=false is ignored: the request is still taken by the fast lane (a card, then the picture), never refused", async () => {
    net([{ type: "image", b64: "x" }]);
    const { bot, sent } = fakeBot();
    const d: any = pgDb();
    const { loadState, saveState } = await import("@/lib/coderSections");
    const st: any = await loadState(OWNER, d); st.perModel = { coder: { media: false } };
    await saveState(OWNER, st, d);
    await handleCoderSections(bot, botRow, say("قم بتوليد صورة اسد"), d);
    expect(sent.length).toBeGreaterThanOrEqual(1);
    expect(sent.some((x) => /متوقف|للمالك/.test(x.text))).toBe(false);
  });
  it("the Studio URL: the variable wins, 'off' disables it, and a runtime WITHOUT the variable uses the known Studio (outside tests)", () => {
    expect(novaMediaUrl()).toBe("https://media.test");
    process.env.NOVA_MEDIA_STUDIO_URL = "off"; expect(novaMediaUrl()).toBe("");
    delete process.env.NOVA_MEDIA_STUDIO_URL; expect(novaMediaUrl()).toBe("");                 // tests: no accidental network
    const was = process.env.NODE_ENV; (process.env as any).NODE_ENV = "production";
    try { expect(novaMediaUrl()).toBe(DEFAULT_NOVA_MEDIA_URL); } finally { (process.env as any).NODE_ENV = was; }
  });
  it("a media client call that finds the Studio busy waits and asks again", async () => {
    let n = 0;
    const f = (async (url: string) => (String(url).includes("/call/v2/") ? new Response(JSON.stringify({ event_id: "m" })) : new Response(sse(++n < 3 ? { type: "busy" } : { type: "image", b64: b64(await png("gradient", 256)) })))) as any;
    const waits: number[] = [];
    const r = await novaMakeMedia("image", "a lion", { fetchImpl: f, onWait: (k) => waits.push(k), timeoutMs: 120000 });
    expect(r?.type).toBe("image");
    expect(waits).toEqual([1, 2]);
  });
});
