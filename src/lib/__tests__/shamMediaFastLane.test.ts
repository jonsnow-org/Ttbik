// Sham / Sham v2: an explicit picture request goes to the chosen media route BEFORE the model (2026-10-28: the model wrote
// "قم بتوليد صورة فرس ابيض ← sandbox_exec ثم sandbox_write_file." as its answer and nothing was made); a tool plan is never delivered as an answer.
import { looksLikeToolPlan } from "@/lib/coderMediaFast";
import { shamVariant } from "@/lib/shamStudio";

const routeCalls: any[][] = [];
let routeReply: any = null;
let mockLastMemory: any = null;
let mockPendingMedia: any = null;
let mockTranslations: (string | null)[] = ["white horse"];
jest.mock("@/lib/shamMediaRoutes", () => ({ generateShamMediaThroughRoute: jest.fn(async (...a: any[]) => { routeCalls.push(a); return routeReply; }) }));
jest.mock("@/lib/shamStudio", () => ({
  ...jest.requireActual("@/lib/shamStudio"),
  shamChatAuto: jest.fn(async () => ({ type: "text", text: "بالطبع! إليك تقريراً موجهاً..." })),
  shamGenerate: jest.fn(async () => mockTranslations.shift() ?? null),
}));
jest.mock("@/lib/shamThreads", () => ({
  loadChatMemory: jest.fn(async () => mockLastMemory),
  saveChatTurn: jest.fn(async () => undefined),
  loadPendingMediaIntent: jest.fn(async () => mockPendingMedia),
  savePendingMediaIntent: jest.fn(async (_chatId: number, _variant: string, intent: any) => { mockPendingMedia = intent; }),
  clearPendingMediaIntent: jest.fn(async () => { mockPendingMedia = null; }),
}));
jest.mock("@/lib/coderTasks", () => ({ ...jest.requireActual("@/lib/coderTasks"), taskStart: jest.fn(async () => undefined), taskEvent: jest.fn(async () => undefined), taskStatus: jest.fn(async () => undefined) }));

const bot = () => {
  const calls: { m: string; a: any[] }[] = [];
  const api: any = new Proxy({}, { get: (_t, m: string) => async (...a: any[]) => { calls.push({ m, a }); return { message_id: 1 }; } });
  return { bot: { api } as any, calls };
};
const tiny = Buffer.from("png").toString("base64");

describe("Sham media fast lane", () => {
  beforeEach(() => {
    routeCalls.length = 0; routeReply = null; mockLastMemory = null; mockPendingMedia = null; mockTranslations = ["white horse"];
    process.env.CODER_TOKEN_KEY = "k";
    process.env.MODELSCOPE_API_TOKEN = "test-token";
    process.env.SHAM_V2_URL = "https://studio-sham-v2.test";
    process.env.SUPER_ADMIN_TELEGRAM_ID = "77";
    (global as any).fetch = jest.fn(async (_url: string, init?: any) => init?.method === "POST"
      ? new Response(JSON.stringify({ event_id: "e1" }), { status: 200 })
      : new Response("event: complete\ndata: " + JSON.stringify(JSON.stringify({ type: "text", text: "white horse" })) + "\n\n", { status: 200 }));
  });
  it("'قم بتوليد صورة فرس ابيض' on Sham v2 -> always translated (the picture model reads English only), no prompt caption", async () => {
    routeReply = { type: "image", b64: tiny, route: "sham_v2_ready" };
    const { shamMediaFastLane } = await import("@/lib/novaBotLogic");
    const { bot: b, calls } = bot();
    expect(await shamVariant.run("v2", () => shamMediaFastLane(b, 77, "قم بتوليد صورة فرس ابيض"))).toBe(true);
    expect(routeCalls[0][0]).toBe("image");
    expect(routeCalls[0][1]).toBe("white horse");
    expect(routeCalls[0][2]).toMatchObject({ bypassContentHeuristics: true });
    const photo = calls.find((c) => c.m === "sendPhoto")!;
    expect(photo).toBeTruthy();
    expect(photo.a[2]?.caption).toBeUndefined();                             // owner 2026-11-04: the English prompt is never shown (MEDIA_SHOW_PROMPT=1 brings it back for tests)
    const msgs = calls.filter((c) => c.m === "sendMessage");
    expect(msgs).toHaveLength(1);                                          // the ONE message: the card (opened at once, with date + time) ...
    expect(msgs[0].a[1]).toMatch(/^🕒 .*\d{1,2}:\d\d:\d\d [صم]\n💬 /);
    expect(msgs[0].a[1]).not.toMatch(/فهمت طلبك/);                          // no canned echo of the request
    expect(calls.some((c) => c.m === "deleteMessage")).toBe(true);         // ... which goes when the picture is sent (media is its own message)
  });
  it("resumes image generation when the user replies with only 'حصان أبيض' after a description question", async () => {
    mockLastMemory = { history: [{
      q: "قم بتوليد صورة",
      a: "تعذّر فهم وصف الصورة بما يكفي لإنشائها. اكتب الوصف بجملة أوضح.",
    }] };
    routeReply = { type: "image", b64: tiny, route: "sham_v2_ready" };
    const { shamMediaFastLane } = await import("@/lib/novaBotLogic");
    const { bot: b, calls } = bot();
    expect(await shamVariant.run("v2", () => shamMediaFastLane(b, 77, "حصان أبيض"))).toBe(true);
    expect(routeCalls[0][0]).toBe("image");
    expect(routeCalls[0][1]).toBe("white horse");
    expect(calls.some((c) => c.m === "sendPhoto")).toBe(true);
  });
  it("generates the requested image directly when the translation endpoint's first answer is a report", async () => {
    mockTranslations = ["بالطبع! إليك تقرير مُوجَّه لـ شام (الصورة)...", "[tall] a beautiful girl"];
    routeReply = { type: "image", b64: tiny, route: "sham_v2_ready" };
    const { shamMediaFastLane } = await import("@/lib/novaBotLogic");
    const { bot: b, calls } = bot();
    expect(await shamVariant.run("v2", () => shamMediaFastLane(b, 77, "اعطني صورة فتاة جميلة"))).toBe(true);
    expect(routeCalls[0][0]).toBe("image");
    expect(routeCalls[0][1]).toBe("a beautiful girl");
    expect(routeCalls[0][2]).toMatchObject({ aspect: "tall" });
    expect(calls.some((c) => c.m === "sendPhoto")).toBe(true);
    expect(calls.some((c) => c.m === "sendMessage" && /ما الذي تريد أن يظهر/.test(String(c.a[1])))).toBe(false);
  });

  it("chooses a scene itself when the user delegates with only 'اعطني صورة'", async () => {
    mockTranslations = ["[square] a red fox curled up beside a lantern in a quiet snowy forest"];
    routeReply = { type: "image", b64: tiny, route: "sham_v2_ready" };
    const { shamMediaFastLane } = await import("@/lib/novaBotLogic");
    const { bot: b, calls } = bot();
    expect(await shamVariant.run("v2", () => shamMediaFastLane(b, 77, "اعطني صورة"))).toBe(true);
    expect(routeCalls[0][0]).toBe("image");
    expect(routeCalls[0][1]).toMatch(/red fox/);
    expect(calls.some((c) => c.m === "sendPhoto")).toBe(true);
    expect(calls.some((c) => c.m === "sendMessage" && /ما الذي تريد أن يظهر/.test(String(c.a[1])))).toBe(false);
  });

  it("continues a pending image request without depending on optional chat memory", async () => {
    mockPendingMedia = { kind: "image", source: "اعطني صورة", };
    mockLastMemory = null;
    mockTranslations = ["[tall] a beautiful girl"];
    routeReply = { type: "image", b64: tiny, route: "sham_v2_ready" };
    const { shamMediaFastLane } = await import("@/lib/novaBotLogic");
    const { bot: b, calls } = bot();
    expect(await shamVariant.run("v2", () => shamMediaFastLane(b, 77, "فتاة جميلة"))).toBe(true);
    expect(routeCalls[0][1]).toBe("a beautiful girl");
    expect(calls.some((c) => c.m === "sendPhoto")).toBe(true);
  });

  it("never delivers a translator report as if it were a picture or asks the old fixed question", async () => {
    mockTranslations = ["بالطبع! إليك تقرير مُوجَّه...", "الموضوع: فتاة جميلة\\nالتفاصيل: ..."];
    routeReply = { type: "image", b64: tiny, route: "sham_v2_ready" };
    const { shamMediaFastLane } = await import("@/lib/novaBotLogic");
    const { bot: b, calls } = bot();
    expect(await shamVariant.run("v2", () => shamMediaFastLane(b, 77, "اعطني صورة فتاة جميلة"))).toBe(true);
    expect(routeCalls).toHaveLength(0);
    expect(calls.some((c) => c.m === "sendPhoto")).toBe(false);
    const failure = calls.find((c) => c.m === "editMessageText");
    expect(String(failure?.a[2] || "")).toContain("لم أتمكن من تجهيز مطالبة صالحة");
    expect(calls.some((c) => c.m === "sendMessage" && /ما الذي تريد أن يظهر/.test(String(c.a[1])))).toBe(false);
  });

  it("passes an Arabic requested video duration to the Sham v2 video route", async () => {
    routeReply = { type: "video", mime: "video/mp4", b64: tiny, route: "sham_v2_ready" };
    const { shamMediaFastLane } = await import("@/lib/novaBotLogic");
    const { bot: b, calls } = bot();
    expect(await shamVariant.run("v2", () => shamMediaFastLane(b, 77, "قم بتوليد فيديو فرس أبيض لمدة 30 ثانية"))).toBe(true);
    expect(routeCalls[0][0]).toBe("video");
    expect(routeCalls[0][2]).toMatchObject({ seconds: 30 });
    expect(calls.some((c) => c.m === "sendVideo")).toBe(true);
  });

  it("old Sham (v1) reads the user's language as written: no translation", async () => {
    routeReply = { type: "image", b64: tiny, route: "sham_v1" };
    const { shamMediaFastLane } = await import("@/lib/novaBotLogic");
    const { bot: b } = bot();
    expect(await shamVariant.run("v1", () => shamMediaFastLane(b, 77, "قم بتوليد صورة فرس ابيض"))).toBe(true);
    expect(routeCalls[0][0]).toBe("image");
    expect(routeCalls[0][1]).toBe("فرس ابيض");
  });

  it("a failed route says so plainly and sends nothing", async () => {
    routeReply = { type: "error", text: "disk" };
    const { shamMediaFastLane } = await import("@/lib/novaBotLogic");
    const { bot: b, calls } = bot();
    expect(await shamVariant.run("v2", () => shamMediaFastLane(b, 77, "ارسم قطة سوداء"))).toBe(true);
    expect(calls.some((c) => c.m === "sendPhoto")).toBe(false);
    expect(calls.filter((c) => c.m === "sendMessage")).toHaveLength(1);    // still ONE message: the failure is written into it
    expect(calls.find((c) => c.m === "editMessageText")!.a[2]).toMatch(/تعذّر إنشاء الصورة/);
  });
  it("other messages are left to the model", async () => {
    const { shamMediaFastLane } = await import("@/lib/novaBotLogic");
    const { bot: b, calls } = bot();
    expect(await shamVariant.run("v2", () => shamMediaFastLane(b, 77, "اكتب كود بايثون"))).toBe(false);
    expect(await shamVariant.run("v2", () => shamMediaFastLane(b, 77, "مرحبا"))).toBe(false);
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
