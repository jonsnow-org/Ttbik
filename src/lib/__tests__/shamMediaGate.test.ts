import { shamChatAuto, shamGenerateAny, shamGenerateMedia, shamVariant, vetShamReply } from "@/lib/shamStudio";
import { b64, png, wav } from "./mediaFixtures";

const sse = (o: object) => `event: complete\ndata: [${JSON.stringify(JSON.stringify(o))}]\n`;
function studio(reply: object) {
  (global as any).fetch = jest.fn(async (url: string, init?: any) =>
    init?.method === "POST" ? new Response(JSON.stringify({ event_id: "e1" }), { status: 200 }) : new Response(sse(reply), { status: 200 }));
}
beforeEach(() => { process.env.MODELSCOPE_API_TOKEN = "t"; process.env.SHAM_V2_URL = "https://v2.test"; process.env.SHAM_MODELSCOPE_URL = "https://v1.test"; });

describe("Sham Studio replies pass the media quality gate", () => {
  it("a black picture from generate_any / chat_auto becomes a typed error (no bytes), a real picture passes", async () => {
    studio({ type: "image", mime: "image/png", b64: b64(await png("black", 512)) });
    expect(await shamVariant.run("v1", () => shamGenerateAny("ارسم قطة"))).toMatchObject({ type: "error", reason: "blank_image" });
    expect((await shamVariant.run("v1", () => shamChatAuto("ارسم قطة")))?.b64).toBeUndefined();
    const good = b64(await png("gradient"));
    studio({ type: "image", mime: "image/png", b64: good });
    expect(await shamVariant.run("v1", () => shamGenerateAny("ارسم قطة"))).toMatchObject({ type: "image", b64: good });
  });
  it("the owner raw_test option reaches the private Sham Studio media endpoint", async () => {
    const black = b64(await png("black", 512));
    let submitted: any = null;
    (global as any).fetch = jest.fn(async (_url: string, init?: any) => {
      if (init?.method === "POST") { submitted = JSON.parse(String(init.body)); return new Response(JSON.stringify({ event_id: "e1" }), { status: 200 }); }
      return new Response(sse({ type: "image", mime: "image/png", b64: black }), { status: 200 });
    });
    const reply = await shamVariant.run("v2", () => shamGenerateMedia("image", "a test image", 45000, "internal", { bypassQuality: true }));
    expect(submitted).toMatchObject({ raw_test: true });
    expect(reply).toMatchObject({ type: "image", b64: black });
  });
  it("owner raw-output test can reveal a blank image without changing the default gate", async () => {
    const blank = { type: "image" as const, mime: "image/png", b64: b64(await png("black", 512)) };
    expect(await vetShamReply(blank)).toMatchObject({ type: "error", reason: "blank_image" });
    expect(await vetShamReply(blank, { bypassContentHeuristics: true })).toEqual(blank);
  });
  it("silent audio and an empty video are errors; results finished later (`later`) are vetted too", async () => {
    expect(await vetShamReply({ type: "audio", b64: b64(wav("silence")) })).toMatchObject({ reason: "silent_audio" });
    expect(await vetShamReply({ type: "video", b64: "AAAA" })).toMatchObject({ reason: "empty_video" });
    const out = await vetShamReply({ type: "text", text: "x", later: [{ type: "image", b64: b64(await png("black")) }, { type: "text", text: "ok" }] });
    expect(out?.later?.[0]).toMatchObject({ type: "error", reason: "blank_image" });
    expect(out?.later?.[1]).toEqual({ type: "text", text: "ok" });
  });
});
