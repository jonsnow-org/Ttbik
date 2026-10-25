import { wireMessages, hasImages, coderChat } from "@/lib/openCoderStudio";
import { dropShownImages, toModelImage } from "@/lib/coderVision";
import { toolGroups, runTool } from "@/lib/coderAgent";

const sse = (o: object) => `event: complete\ndata: [${JSON.stringify(JSON.stringify(o))}]\n`;

describe("pictures for the model", () => {
  it("a user message with pictures becomes text + image parts; nothing else changes", () => {
    const m: any[] = [{ role: "system", content: "s" }, { role: "user", content: "what is this?", images: ["data:image/jpeg;base64,AAAA"] }, { role: "assistant", content: "a cat" }];
    expect(hasImages(m)).toBe(true);
    const w: any[] = wireMessages(m);
    expect(w[0]).toEqual(m[0]); expect(w[2]).toEqual(m[2]);
    expect(w[1].content).toEqual([{ type: "text", text: "what is this?" }, { type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } }]);
    expect(w[1].images).toBeUndefined();
    expect(hasImages([{ role: "user", content: "x" }])).toBe(false);
  });
  it("a request with a picture goes to a Studio that says it reads pictures, and to none when no Studio does", async () => {
    process.env.OPEN_CODER_STUDIO_URL = "https://v1.test";
    process.env.OPEN_CODER_STUDIO_URLS = "https://v1.test,https://v2.test";
    process.env.MODELSCOPE_API_TOKEN = "ms";
    let visionHost = "https://v2.test";
    const chatHosts: string[] = [];
    (global as any).fetch = jest.fn(async (url: string) => {
      const host = new URL(url).origin;
      if (url.includes("/gradio_api/call/v2/")) return new Response(JSON.stringify({ event_id: "e" }), { status: 200 });
      if (url.includes("status")) return new Response(sse({ phase: "ready", queue: 0, vision: host === visionHost }), { status: 200 });
      if (url.includes("/gradio_api/call/")) { chatHosts.push(host); return new Response(sse({ type: "done", job: "j", text: "ok", tool_calls: [] }), { status: 200 }); }
      return new Response("{}", { status: 200 });
    });
    const pic: any[] = [{ role: "user", content: "look", images: ["data:image/jpeg;base64,AAAA"] }];
    const o = await coderChat(pic, { waitS: 1, timeoutMs: 5000 });
    expect(o.reply?.type).toBe("done"); expect(chatHosts).toEqual(["https://v2.test"]);
    await coderChat([{ role: "user", content: "text only" }] as any, { waitS: 1, timeoutMs: 5000 });
    expect(chatHosts.length).toBe(2);                                                       // a plain request is not restricted
    visionHost = "";
    await new Promise((r) => setTimeout(r, 1600));                                          // the shared status answer expires
    const none = await coderChat(pic, { waitS: 1, timeoutMs: 5000 });
    expect(none.reply).toBeNull(); expect(none.detail).toMatch(/no Studio reads pictures/);
    delete process.env.OPEN_CODER_STUDIO_URLS;
  });
  it("a shown picture becomes a note after the model answered; one not yet answered stays", () => {
    const m: any[] = [{ role: "user", content: "a", images: ["x"] }, { role: "assistant", content: "seen" }, { role: "user", content: "b", images: ["y"] }];
    dropShownImages(m);
    expect(m[0].images).toBeUndefined(); expect(m[0].content).toMatch(/was shown to you here and already answered/); expect(m[2].images).toEqual(["y"]);
  });
  it("any common picture becomes a small JPEG; a non-picture is refused", async () => {
    const sharp = (await import("sharp")).default;
    const png = await sharp({ create: { width: 1600, height: 900, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } } }).png().toBuffer();
    const url = await toModelImage(png, 512);
    expect(url).toMatch(/^data:image\/jpeg;base64,/);
    const meta = await sharp(Buffer.from(url!.split(",")[1], "base64")).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(512); expect(meta.format).toBe("jpeg");
    expect(await toModelImage(Buffer.from("not a picture"))).toBeNull();
  });
  it("the media group exists and its tools are refused for a sub-agent that cannot show or send", async () => {
    expect(toolGroups(true, false).media.map((t) => t.function.name).sort()).toEqual(["make_media", "view_image", "view_video"]);
    expect(await runTool({ id: "1", type: "function", function: { name: "view_image", arguments: "{}" } }, { gh: null, addNote: () => undefined })).toMatch(/main chat or in a worker only/);
  });
});
