import { shamChatAuto, shamGenerateAny, vetShamReply } from "@/lib/shamStudio";
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
    expect(await shamGenerateAny("ارسم قطة")).toMatchObject({ type: "error", reason: "blank_image" });
    expect((await shamChatAuto("ارسم قطة"))?.b64).toBeUndefined();
    const good = b64(await png("gradient"));
    studio({ type: "image", mime: "image/png", b64: good });
    expect(await shamGenerateAny("ارسم قطة")).toMatchObject({ type: "image", b64: good });
  });
  it("silent audio and an empty video are errors; results finished later (`later`) are vetted too", async () => {
    expect(await vetShamReply({ type: "audio", b64: b64(wav("silence")) })).toMatchObject({ reason: "silent_audio" });
    expect(await vetShamReply({ type: "video", b64: "AAAA" })).toMatchObject({ reason: "empty_video" });
    const out = await vetShamReply({ type: "text", text: "x", later: [{ type: "image", b64: b64(await png("black")) }, { type: "text", text: "ok" }] });
    expect(out?.later?.[0]).toMatchObject({ type: "error", reason: "blank_image" });
    expect(out?.later?.[1]).toEqual({ type: "text", text: "ok" });
  });
});
