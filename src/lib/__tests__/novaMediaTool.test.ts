// Nova's make_media tool: Nova's OWN media Studio only (never Sham's routes), a black picture is never sent, and Nova is told plainly when nothing was made.
import { drive, loadState, saveState } from "@/lib/coderSections";
import { novaMakeMedia } from "@/lib/novaMedia";
import { fakeBot, fakeDb } from "./coderFakes";
import { b64, png } from "./mediaFixtures";

jest.mock("dns/promises", () => ({ lookup: jest.fn(async () => [{ address: "93.184.216.34", family: 4 }]) }));

const CHAT = 6161;
const botRow = { id: "bot1", token: "T", webhookSecret: "whs", isActive: true, template: "NOVA_BOT" } as any;
const sse = (o: object) => `event: complete\ndata: [${JSON.stringify(JSON.stringify(o))}]\n`;
const call = (id: string, name: string, args: object) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });

/** a fake network: the coder Studio (model replies) + Nova's media Studio (image answers in order) + records every URL */
function net(modelReplies: object[], imageAnswers: object[]) {
  const urls: string[] = [], seeds: number[] = [];
  let m = 0, im = 0;
  (global as any).fetch = jest.fn(async (url: string, init?: any) => {
    urls.push(url);
    if (url.endsWith("/api/coder/continue")) return new Response("{}", { status: 202 });
    if (url.startsWith("https://media.test")) {
      if (url.includes("/call/v2/")) { try { seeds.push(JSON.parse(JSON.parse(init.body).body).seed); } catch { /* not an image call */ } return new Response(JSON.stringify({ event_id: "m1" }), { status: 200 }); }
      return new Response(sse(imageAnswers[Math.min(im++, imageAnswers.length - 1)] as object), { status: 200 });
    }
    if (url.includes("/gradio_api/call/v2/")) return new Response(JSON.stringify({ event_id: `e${urls.length}` }), { status: 200 });
    if (url.includes("/gradio_api/call/")) return new Response(sse(modelReplies[Math.min(m++, modelReplies.length - 1)] as object), { status: 200 });
    return new Response("{}", { status: 202 });
  });
  return { urls, seeds };
}
const run = (id: string) => ({ id, chain: "c", sent: 0, step: 0, lease: Date.now(), source: "interactive" as const, slot: "" });
const st0 = (content: string, r: any) => ({ mode: "coder" as const, think: false, messages: [{ role: "user" as const, content }], notes: "", inbox: [], run: r });

beforeEach(() => {
  process.env.OPEN_CODER_STUDIO_URL = "https://coder.test";
  process.env.NOVA_MEDIA_STUDIO_URL = "https://media.test";
  process.env.MODELSCOPE_API_TOKEN = "ms";
  process.env.CODER_POLL_MS = "5";
  process.env.SUPER_ADMIN_TELEGRAM_ID = String(CHAT);
  process.env.CODER_TOKEN_KEY = "test-key";
  delete process.env.SHAM_STUDIO_URL; delete process.env.SHAM_V2_URL;
});

describe("novaMakeMedia retries a refused picture with another seed", () => {
  it("black, then a real picture: the real one is returned and the seed changed", async () => {
    const good = b64(await png("gradient", 256)), black = b64(await png("black", 256));
    const { seeds } = net([], [{ type: "image", b64: black }, { type: "image", b64: good }]);
    const r = await novaMakeMedia("image", "a rabbit");
    expect(r?.type).toBe("image");
    expect(r?.b64).toBe(good);
    expect(seeds).toEqual([0, 1]);
  });
  it("black every time: an honest typed error after 3 tries, never the black picture", async () => {
    const black = b64(await png("black", 256));
    const { seeds } = net([], [{ type: "image", b64: black }]);
    const r = await novaMakeMedia("image", "a rabbit");
    expect(r?.type).toBe("error");
    expect(r?.reason).toBe("blank_image");
    expect(r?.b64).toBeUndefined();
    expect(seeds).toEqual([0, 1, 2]);
  });
});

describe("the make_media tool in a Nova task", () => {
  it("a real picture is sent once, from Nova's own Studio, and no Sham Studio is touched", async () => {
    const good = b64(await png("gradient", 256));
    const { urls } = net([{ type: "done", job: "j1", text: "", tool_calls: [call("m", "make_media", { kind: "image", prompt: "a cute rabbit" })] }, { type: "done", job: "j2", text: "هذه صورة الأرنب.", tool_calls: [] }], [{ type: "image", b64: good }]);
    const db = fakeDb();
    const { bot, sent, api } = fakeBot();
    (api as any).sendPhoto = jest.fn(async () => ({ message_id: 1 }));
    await saveState(CHAT, st0("ارسم أرنباً", run("r1")), db);
    await drive(bot, botRow, CHAT, "c", db, 40000);
    expect((api as any).sendPhoto).toHaveBeenCalledTimes(1);
    expect(urls.some((u) => /sham/i.test(u))).toBe(false);
    expect(urls.some((u) => u.startsWith("https://media.test"))).toBe(true);
    expect(sent.some((s) => /هذه صورة الأرنب/.test(s.text))).toBe(true);
  });

  it("a black result is never sent; the model is told nothing was sent", async () => {
    const black = b64(await png("black", 256));
    net([{ type: "done", job: "j1", text: "", tool_calls: [call("m", "make_media", { kind: "image", prompt: "a cute rabbit" })] }, { type: "done", job: "j2", text: "تعذّر توليد الصورة.", tool_calls: [] }], [{ type: "image", b64: black }]);
    const db = fakeDb();
    const { bot, api } = fakeBot();
    (api as any).sendPhoto = jest.fn(async () => ({ message_id: 1 }));
    await saveState(CHAT, st0("ارسم أرنباً", run("r2")), db);
    await drive(bot, botRow, CHAT, "c", db, 40000);
    expect((api as any).sendPhoto).not.toHaveBeenCalled();
    const st = await loadState(CHAT, db);
    const toolMsg = st.messages.find((m: any) => m.role === "tool" && m.name === "make_media") as any;
    expect(toolMsg.content).toMatch(/^error:/);
    expect(toolMsg.content).toMatch(/NOTHING was sent/);
  });

  it("without Nova's media Studio it says so honestly — it does NOT fall back to Sham", async () => {
    delete process.env.NOVA_MEDIA_STUDIO_URL;
    process.env.SHAM_STUDIO_URL = "https://sham.test";
    const { urls } = net([{ type: "done", job: "j1", text: "", tool_calls: [call("m", "make_media", { kind: "image", prompt: "a rabbit" })] }, { type: "done", job: "j2", text: "غير متاح.", tool_calls: [] }], []);
    const db = fakeDb();
    const { bot, api } = fakeBot();
    (api as any).sendPhoto = jest.fn();
    await saveState(CHAT, st0("ارسم", run("r3")), db);
    await drive(bot, botRow, CHAT, "c", db, 40000);
    expect((api as any).sendPhoto).not.toHaveBeenCalled();
    expect(urls.some((u) => u.includes("sham.test"))).toBe(false);
    const st = await loadState(CHAT, db);
    expect((st.messages.find((m: any) => m.role === "tool" && m.name === "make_media") as any).content).toMatch(/not connected/);
  });

  it("with Media generation switched off for Nova in the app settings, make_media makes and sends nothing", async () => {
    const good = b64(await png("gradient", 256));
    const { urls } = net([{ type: "done", job: "j1", text: "", tool_calls: [call("m", "make_media", { kind: "image", prompt: "a rabbit" })] }, { type: "done", job: "j2", text: "الوسائط متوقفة.", tool_calls: [] }], [{ type: "image", b64: good }]);
    const db = fakeDb();
    const { bot, api } = fakeBot();
    (api as any).sendPhoto = jest.fn();
    await saveState(CHAT, { ...st0("ارسم", run("r4")), perModel: { coder: { media: false } } } as any, db);
    await drive(bot, botRow, CHAT, "c", db, 40000);
    expect((api as any).sendPhoto).not.toHaveBeenCalled();
    expect(urls.some((u) => u.startsWith("https://media.test"))).toBe(false);
    const st = await loadState(CHAT, db);
    expect((st.messages.find((m: any) => m.role === "tool" && m.name === "make_media") as any).content).toMatch(/switched off/);
  });
});
