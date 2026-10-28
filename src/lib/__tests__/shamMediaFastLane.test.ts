// Sham / Sham v2: an explicit picture request goes to the chosen media route BEFORE the model (2026-10-28: the model wrote
// "قم بتوليد صورة فرس ابيض ← sandbox_exec ثم sandbox_write_file." as its answer and nothing was made); a tool plan is never delivered as an answer.
import { looksLikeToolPlan } from "@/lib/coderMediaFast";

const routeCalls: any[][] = [];
let routeReply: any = null;
jest.mock("@/lib/shamMediaRoutes", () => ({ generateShamMediaThroughRoute: jest.fn(async (...a: any[]) => { routeCalls.push(a); return routeReply; }) }));
jest.mock("@/lib/shamThreads", () => ({ loadChatMemory: jest.fn(async () => null), saveChatTurn: jest.fn(async () => undefined) }));
jest.mock("@/lib/coderTasks", () => ({ ...jest.requireActual("@/lib/coderTasks"), taskStart: jest.fn(async () => undefined), taskEvent: jest.fn(async () => undefined), taskStatus: jest.fn(async () => undefined) }));

const bot = () => {
  const calls: { m: string; a: any[] }[] = [];
  const api: any = new Proxy({}, { get: (_t, m: string) => async (...a: any[]) => { calls.push({ m, a }); return { message_id: 1 }; } });
  return { bot: { api } as any, calls };
};
const tiny = Buffer.from("png").toString("base64");

describe("Sham media fast lane", () => {
  beforeEach(() => { routeCalls.length = 0; process.env.CODER_TOKEN_KEY = "k"; });
  it("'قم بتوليد صورة فرس ابيض' -> the media route with an ENGLISH prompt; the picture is sent without a caption", async () => {
    routeReply = { type: "image", b64: tiny, route: "sham_v2_ready" };
    const { shamMediaFastLane } = await import("@/lib/novaBotLogic");
    const { bot: b, calls } = bot();
    expect(await shamMediaFastLane(b, 77, "قم بتوليد صورة فرس ابيض")).toBe(true);
    expect(routeCalls[0][0]).toBe("image");
    expect(routeCalls[0][1]).toBe("white horse");
    const photo = calls.find((c) => c.m === "sendPhoto")!;
    expect(photo).toBeTruthy();
    expect(photo.a[2]).toBeUndefined();                                    // no caption at all
    const msgs = calls.filter((c) => c.m === "sendMessage");
    expect(msgs).toHaveLength(1);                                          // the ONE message: the card (opened at once, with date + time) ...
    expect(msgs[0].a[1]).toMatch(/^🕒 .*\d\d:\d\d:\d\d\n💬 /);
    expect(msgs[0].a[1]).not.toMatch(/فهمت طلبك/);                          // no canned echo of the request
    expect(calls.some((c) => c.m === "deleteMessage")).toBe(true);         // ... which goes when the picture is sent (media is its own message)
  });
  it("a failed route says so plainly and sends nothing", async () => {
    routeReply = { type: "error", text: "disk" };
    const { shamMediaFastLane } = await import("@/lib/novaBotLogic");
    const { bot: b, calls } = bot();
    expect(await shamMediaFastLane(b, 77, "ارسم قطة سوداء")).toBe(true);
    expect(calls.some((c) => c.m === "sendPhoto")).toBe(false);
    expect(calls.filter((c) => c.m === "sendMessage")).toHaveLength(1);    // still ONE message: the failure is written into it
    expect(calls.find((c) => c.m === "editMessageText")!.a[2]).toMatch(/تعذّر إنشاء الصورة/);
  });
  it("other messages are left to the model", async () => {
    const { shamMediaFastLane } = await import("@/lib/novaBotLogic");
    const { bot: b, calls } = bot();
    expect(await shamMediaFastLane(b, 77, "اكتب كود بايثون")).toBe(false);
    expect(await shamMediaFastLane(b, 77, "مرحبا")).toBe(false);
    expect(calls.length).toBe(0);
  });
});

describe("a tool plan is not an answer", () => {
  it("catches the live leak and similar, leaves real answers alone", () => {
    expect(looksLikeToolPlan("قم بتوليد صورة فرس ابيض ← sandbox_exec ثم sandbox_write_file.")).toBe(true);
    expect(looksLikeToolPlan("make_media then sandbox_exec")).toBe(true);
    expect(looksLikeToolPlan("استخدمت sandbox_exec لتشغيل الأمر وكانت النتيجة نجاح كل الاختبارات والحمد لله، وهذا ملخص ما حدث بالتفصيل في المشروع.")).toBe(false);
    expect(looksLikeToolPlan("الفرس حيوان جميل")).toBe(false);
  });
});
