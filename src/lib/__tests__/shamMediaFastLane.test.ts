// Sham / Sham v2: an explicit picture / clip request goes to the chosen media route BEFORE the model (2026-10-28: the model wrote
// "قم بتوليد صورة فرس ابيض ← sandbox_exec ثم sandbox_write_file." as its answer and nothing was made); a tool plan is never delivered as an answer.
// 2026-11-05 (owner): the work is a DURABLE job carried across the signed continuation legs, because a real CPU clip never fitted the 60 s webhook.
// The webhook leg only detects the request and hands off; the media leg writes the prompt, generates and delivers the file.
import { looksLikeToolPlan } from "@/lib/coderMediaFast";
import { shamVariant } from "@/lib/shamStudio";

const routeCalls: any[][] = [];
let routeReply: any = null;
let mockLastMemory: any = null;
let continuation: { ok: true } | { ok: false; uncertain: boolean; reason: string } = { ok: true };
const runs = new Map<string, any>();
const videoStarts: string[] = [];
jest.mock("@/lib/shamMediaRoutes", () => ({ generateShamMediaThroughRoute: jest.fn(async (...a: any[]) => { routeCalls.push(a); return routeReply; }) }));
jest.mock("@/lib/shamStudio", () => ({ ...jest.requireActual("@/lib/shamStudio"), shamChatAuto: jest.fn(async () => ({ type: "text", text: "white horse" })), vetShamReply: jest.fn(async (r: any) => r), shamVideoStart: jest.fn(async (_b: string, body: string) => { videoStarts.push(body); return { job: "j1" }; }), shamVideoJob: jest.fn(async () => ({ reply: JSON.stringify({ type: "video", mime: "video/mp4", b64: Buffer.from("mp4").toString("base64") }) })) }));
jest.mock("@/lib/shamThreads", () => ({ loadChatMemory: jest.fn(async () => mockLastMemory), saveChatTurn: jest.fn(async () => undefined) }));
jest.mock("@/lib/shamContinuation", () => ({ postShamContinuation: jest.fn(async () => continuation) }));
jest.mock("@/lib/shamExec", () => ({ ...jest.requireActual("@/lib/shamExec"), shamSaveRun: jest.fn(async (run: any) => { runs.set(run.runId, run); }), shamTakeRun: jest.fn(async (_chat: number, runId: string) => runs.get(runId) ?? null) }));
jest.mock("@/lib/coderTasks", () => ({ ...jest.requireActual("@/lib/coderTasks"), taskStart: jest.fn(async () => undefined), taskEvent: jest.fn(async () => undefined), taskStatus: jest.fn(async () => undefined), taskTouch: jest.fn(async () => undefined), taskIsActive: jest.fn(async () => true) }));

const bot = () => {
  const calls: { m: string; a: any[] }[] = [];
  const api: any = new Proxy({}, { get: (_t, m: string) => async (...a: any[]) => { calls.push({ m, a }); return { message_id: 1 }; } });
  return { bot: { api } as any, calls };
};
const tiny = Buffer.from("png").toString("base64");
/** The media leg takes its state from sham_runs2; seed it exactly as the webhook lane did. */
const seed = async (runId: string, media: any) => { const { shamSaveRun } = await import("@/lib/shamExec"); await shamSaveRun({ chatId: 77, botId: "bot1", runId, request: media.request, messages: [], leg: 0, variant: "v2", mode: {}, card: { msgId: 1, startedAt: Date.now(), steps: [], at: Date.now() }, media }); };

describe("Sham media fast lane", () => {
  beforeEach(async () => {
    routeCalls.length = 0; routeReply = null; mockLastMemory = null; continuation = { ok: true }; runs.clear();
    process.env.CODER_SELF_URL = "https://self.test";
    process.env.MODELSCOPE_API_TOKEN = "test-token";
    process.env.SHAM_V2_URL = "https://studio-sham-v2.test";
    process.env.SUPER_ADMIN_TELEGRAM_ID = "77";
    (global as any).fetch = jest.fn(async (_url: string, init?: any) => init?.method === "POST"
      ? new Response(JSON.stringify({ event_id: "e1" }), { status: 200 })
      : new Response("event: complete\ndata: " + JSON.stringify(JSON.stringify({ type: "text", text: "white horse" })) + "\n\n", { status: 200 }));
  });

  it("the webhook detects the picture request, hands off, and sends nothing itself", async () => {
    const { shamMediaFastLane } = await import("@/lib/novaBotLogic");
    const { bot: b, calls } = bot();
    expect(await shamVariant.run("v2", () => shamMediaFastLane(b, 77, "قم بتوليد صورة فرس ابيض"))).toBe(true);
    expect(calls.some((c) => c.m === "sendPhoto")).toBe(false);                 // the webhook returned; the leg does the work
    const msgs = calls.filter((c) => c.m === "sendMessage");
    expect(msgs).toHaveLength(1);                                              // the ONE message: the card (opened at once, with date + time)
    expect(msgs[0].a[1]).toMatch(/^🕒 .*\d{1,2}:\d\d:\d\d [صم]\n💬 /);
  });

  it("the media leg writes the English prompt, generates the picture and delivers it (no caption)", async () => {
    await seed("run-img", { kind: "image", request: "قم بتوليد صورة فرس ابيض", subject: "فرس ابيض", model: "v2", rawTest: false, phase: "translate" });
    routeReply = { type: "image", b64: tiny, route: "sham_v2_ready" };
    const { continueShamRun } = await import("@/lib/novaBotLogic");
    const { bot: b, calls } = bot();
    await shamVariant.run("v2", () => continueShamRun(b, 77, "bot1", "run-img"));
    expect(routeCalls[0][0]).toBe("image");
    expect(routeCalls[0][1]).toBe("white horse");
    const photo = calls.find((c) => c.m === "sendPhoto")!;
    expect(photo).toBeTruthy();
    expect(photo.a[2]?.caption).toBeUndefined();                              // owner 2026-11-04: the English prompt is never shown
    expect(calls.some((c) => c.m === "deleteMessage")).toBe(true);            // the card goes when the picture is sent
  });

  it("the media leg passes the requested video duration to the video Studio job", async () => {
    await seed("run-vid", { kind: "video", request: "قم بتوليد فيديو فرس أبيض لمدة 30 ثانية", subject: "فرس أبيض", model: "v2", rawTest: false, seconds: 30, phase: "generate", prompt: "a white horse" });
    const { continueShamRun } = await import("@/lib/novaBotLogic");
    const { bot: b, calls } = bot();
    await shamVariant.run("v2", () => continueShamRun(b, 77, "bot1", "run-vid"));
    expect(routeCalls[0][0]).toBe("video");                                     // Sham v2's own internal generator (no separate video Studio any more)
    expect(routeCalls[0][2]).toMatchObject({ seconds: 30 });
    expect(videoStarts).toHaveLength(0);
  });

  it("a video Studio without the background-job API still makes the clip through the single call", async () => {
    const { shamVideoStart } = await import("@/lib/shamStudio");
    (shamVideoStart as jest.Mock).mockResolvedValueOnce(null);              // an older Studio app answers nothing to generate_video_start
    await seed("run-vid-old", { kind: "video", request: "قم بتوليد فيديو فرس أبيض", subject: "فرس أبيض", model: "v2", rawTest: false, phase: "generate", prompt: "a white horse" });
    routeReply = { type: "video", b64: tiny, route: "sham_v2_ready" };
    const { continueShamRun } = await import("@/lib/novaBotLogic");
    const { bot: b, calls } = bot();
    await shamVariant.run("v2", () => continueShamRun(b, 77, "bot1", "run-vid-old"));
    expect(routeCalls.some((c) => c[0] === "video")).toBe(true);            // fell back to the single route call
    expect(calls.some((c) => c.m === "sendVideo")).toBe(true);
  });

  it("resumes image generation when the user replies with only 'حصان أبيض' after a description question", async () => {
    mockLastMemory = { history: [{ q: "قم بتوليد صورة", a: "تعذّر فهم وصف الصورة بما يكفي لإنشائها. اكتب الوصف بجملة أوضح." }] };
    const { shamMediaFastLane } = await import("@/lib/novaBotLogic");
    const { bot: b } = bot();
    expect(await shamVariant.run("v2", () => shamMediaFastLane(b, 77, "حصان أبيض"))).toBe(true);
  });

  it("a failed handoff tells the user plainly instead of leaving the message hanging", async () => {
    continuation = { ok: false, uncertain: false, reason: "HTTP 500" };
    const { shamMediaFastLane } = await import("@/lib/novaBotLogic");
    const { bot: b, calls } = bot();
    expect(await shamVariant.run("v2", () => shamMediaFastLane(b, 77, "قم بتوليد صورة فرس ابيض"))).toBe(true);
    const edit = calls.find((c) => c.m === "editMessageText");
    expect(edit?.a[2]).toMatch(/تعذّر بدء إنشاء الوسائط/);
  });

  it("a failed route says so plainly and sends nothing", async () => {
    await seed("run-fail", { kind: "image", request: "ارسم قطة سوداء", subject: "قطة سوداء", model: "v2", rawTest: false, phase: "translate" });
    routeReply = { type: "error", text: "disk" };
    const { continueShamRun } = await import("@/lib/novaBotLogic");
    const { bot: b, calls } = bot();
    await shamVariant.run("v2", () => continueShamRun(b, 77, "bot1", "run-fail"));
    expect(calls.some((c) => c.m === "sendPhoto")).toBe(false);
    const edits = calls.filter((c) => c.m === "editMessageText");
    expect(String(edits.at(-1)!.a[2])).toMatch(/تعذّر إنشاء الصورة/);
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
