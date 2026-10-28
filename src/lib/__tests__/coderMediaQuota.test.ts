// Nova media for EVERYONE within a daily quota: free 3 pictures + 3 videos, more on Plus/Pro, owner unlimited, only successful vetted results counted,
// a clear Arabic message (no "owners only") when the day's quota is used up. Sham and Sham v2 stay owner-only.
import { drive, loadState, saveState } from "@/lib/coderSections";
import { MEDIA_DAILY, mediaDay, mediaLimit, mediaQuotaMessage, releaseMedia, reserveMedia } from "@/lib/coderMedia";
import { setSubscription, upsertPlan, DEFAULT_PLANS } from "@/lib/coderPlans";
import { DEFAULT_MODELS, chooseModel } from "@/lib/coderModels";
import { coderSystemPrompt } from "@/lib/coderAgent";
import { fakeBot } from "./coderFakes";
import { b64, mp4Shell, png } from "./mediaFixtures";
import { pgDb, resetPg } from "./pgDb";

jest.mock("dns/promises", () => ({ lookup: jest.fn(async () => [{ address: "93.184.216.34", family: 4 }]) }));

const OWNER = 4242, FREE = 9001, PLUS = 9002;
const botRow = { id: "bot1", token: "T", webhookSecret: "whs", isActive: true, template: "NOVA_BOT" } as any;
const sse = (o: object) => `event: complete\ndata: [${JSON.stringify(JSON.stringify(o))}]\n`;
const call = (id: string, name: string, args: object) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
const run = (id: string) => ({ id, chain: "c", sent: 0, step: 0, lease: Date.now(), source: "interactive" as const, slot: "" });
const st0 = (content: string, r: any) => ({ mode: "coder" as const, think: false, messages: [{ role: "user" as const, content }], notes: "", inbox: [], run: r });
const db = (): any => pgDb();

function net(modelReplies: object[], media: object) {
  let m = 0;
  (global as any).fetch = jest.fn(async (url: string) => {
    if (url.endsWith("/api/coder/continue")) return new Response("{}", { status: 202 });
    if (url.startsWith("https://media.test")) return url.includes("/call/v2/") ? new Response(JSON.stringify({ event_id: "m1" }), { status: 200 }) : new Response(sse(media), { status: 200 });
    if (url.includes("/gradio_api/call/v2/")) return new Response(JSON.stringify({ event_id: `e${m}` }), { status: 200 });
    if (url.includes("/gradio_api/call/")) return new Response(sse(modelReplies[Math.min(m++, modelReplies.length - 1)] as object), { status: 200 });
    return new Response("{}", { status: 202 });
  });
}
const asks = (n: number, kind: string) => [
  ...Array.from({ length: n }, (_, i) => ({ type: "done", job: `j${i}`, text: "", tool_calls: [call(`m${i}`, "make_media", { kind, prompt: "a white horse" })] })),
  { type: "done", job: "jend", text: "تم.", tool_calls: [] },
];

beforeEach(async () => {
  await resetPg();
  process.env.OPEN_CODER_STUDIO_URL = "https://coder.test";
  process.env.NOVA_MEDIA_STUDIO_URL = "https://media.test";
  process.env.MODELSCOPE_API_TOKEN = "ms";
  process.env.CODER_POLL_MS = "5";
  process.env.SUPER_ADMIN_TELEGRAM_ID = String(OWNER);
  process.env.CODER_TOKEN_KEY = "test-key";
  delete process.env.SHAM_STUDIO_URL; delete process.env.SHAM_V2_URL;
});

describe("the quota itself", () => {
  it("free: 3 pictures and 3 videos a day (separately), the 4th of each is refused; the owner is never counted", async () => {
    const d = db();
    for (let i = 0; i < 3; i++) expect((await reserveMedia(FREE, "image", d)).ok).toBe(true);
    const fourth = await reserveMedia(FREE, "image", d);
    expect(fourth.ok).toBe(false);
    for (let i = 0; i < 3; i++) expect((await reserveMedia(FREE, "video", d)).ok).toBe(true);
    expect((await reserveMedia(FREE, "video", d)).ok).toBe(false);
    for (let i = 0; i < 50; i++) expect((await reserveMedia(OWNER, "video", d)).ok).toBe(true);
    expect((await d.query(`SELECT count(*)::int AS n FROM coder_media_daily WHERE chat_key <> ''`))[0].n).toBe(2);     // only the free user's two rows exist
  });
  it("a released slot (nothing was made) can be used again; the day renews at midnight Istanbul", async () => {
    const d = db();
    const t = Date.parse("2026-10-28T10:00:00Z");
    for (let i = 0; i < 3; i++) await reserveMedia(FREE, "image", d, t);
    expect((await reserveMedia(FREE, "image", d, t)).ok).toBe(false);
    await releaseMedia(FREE, "image", d, t);
    expect((await reserveMedia(FREE, "image", d, t)).ok).toBe(true);
    expect((await reserveMedia(FREE, "image", d, t)).ok).toBe(false);
    expect(mediaDay(Date.parse("2026-10-28T20:59:00Z"))).toBe("2026-10-28");
    expect(mediaDay(Date.parse("2026-10-28T21:00:00Z"))).toBe("2026-10-29");           // 00:00 in Istanbul (UTC+3)
    expect((await reserveMedia(FREE, "image", d, Date.parse("2026-10-28T21:00:00Z"))).ok).toBe(true);
  });
  it("Plus and Pro get more than free; the numbers are consistent with the tiers", async () => {
    const d = db();
    await upsertPlan(DEFAULT_PLANS.find((p) => p.id === "plus")!, d);
    await setSubscription(PLUS, "plus", 30, "stars", d);
    for (let i = 0; i < MEDIA_DAILY.plus.image; i++) expect((await reserveMedia(PLUS, "image", d)).ok).toBe(true);
    expect((await reserveMedia(PLUS, "image", d)).ok).toBe(false);
    expect(MEDIA_DAILY.free.image).toBe(3);
    expect(MEDIA_DAILY.free.video).toBe(3);
    for (const k of ["image", "video", "audio"] as const) { expect(mediaLimit("plus", k)).toBeGreaterThan(mediaLimit("free", k)); expect(mediaLimit("pro", k)).toBeGreaterThan(mediaLimit("plus", k)); }
  });
  it("the refusal message is Arabic, names the daily limit and the upgrade, and never says owners only", async () => {
    const d = db();
    for (let i = 0; i < 3; i++) await reserveMedia(FREE, "image", d);
    const q = await reserveMedia(FREE, "image", d);
    if (q.ok) throw new Error("expected a refusal");
    const msg = mediaQuotaMessage(q);
    expect(msg).toMatch(/الحد|حدّك اليومي/);
    expect(msg).toMatch(/الترقية|بلس|برو/);
    expect(msg).toMatch(/إسطنبول/);
    expect(msg).not.toMatch(/المالك|owner/i);
  });
});

describe("through Nova's make_media tool in a chat", () => {
  it("a free user gets 3 pictures; the 4th request is refused with the upgrade message, nothing is generated for it", async () => {
    const good = b64(await png("gradient", 256));
    net(asks(4, "image"), { type: "image", b64: good });
    const d = db();
    const { bot, sent, api } = fakeBot();
    (api as any).sendPhoto = jest.fn(async () => ({ message_id: 1 }));
    await saveState(FREE, st0("ارسم حصاناً أبيض", run("r1")), d);
    await drive(bot, botRow, FREE, "c", d, 60000);
    expect((api as any).sendPhoto).toHaveBeenCalledTimes(3);
    expect(sent.some((s) => /حدّك اليومي/.test(s.text) && /الترقية/.test(s.text))).toBe(true);
    expect(sent.some((s) => /owner|المالك فقط|للمالك/i.test(s.text))).toBe(false);
    const st = await loadState(FREE, d);
    const tools = st.messages.filter((m: any) => m.role === "tool" && m.name === "make_media") as any[];
    expect(tools.length).toBe(4);
    expect(tools[3].content).toMatch(/quota is used up/);
    expect(tools[3].content).not.toMatch(/only for owners/i);
  });
  it("a free user gets 3 videos; the 4th is refused with the upgrade message", async () => {
    net(asks(4, "video"), { type: "video", b64: b64(mp4Shell(6000)) });
    const d = db();
    const { bot, sent, api } = fakeBot();
    (api as any).sendVideo = jest.fn(async () => ({ message_id: 1 }));
    await saveState(FREE, st0("اصنع فيديو لحصان أبيض", run("r2")), d);
    await drive(bot, botRow, FREE, "c", d, 60000);
    expect((api as any).sendVideo).toHaveBeenCalledTimes(3);
    expect(sent.some((s) => /مقاطع الفيديو/.test(s.text) && /الترقية/.test(s.text))).toBe(true);
  });
  it("a failed / blank result is not counted", async () => {
    const black = b64(await png("black", 256));
    net(asks(1, "image"), { type: "image", b64: black });
    const d = db();
    const { bot, api } = fakeBot();
    (api as any).sendPhoto = jest.fn();
    await saveState(FREE, st0("ارسم", run("r3")), d);
    await drive(bot, botRow, FREE, "c", d, 60000);
    expect((api as any).sendPhoto).not.toHaveBeenCalled();
    expect((await reserveMedia(FREE, "image", d)).used).toBe(1);
  });
  it("the owner is unlimited", async () => {
    const good = b64(await png("gradient", 256));
    net(asks(6, "image"), { type: "image", b64: good });
    const d = db();
    const { bot, sent, api } = fakeBot();
    (api as any).sendPhoto = jest.fn(async () => ({ message_id: 1 }));
    await saveState(OWNER, st0("ارسم", run("r4")), d);
    await drive(bot, botRow, OWNER, "c", d, 60000);
    expect((api as any).sendPhoto).toHaveBeenCalledTimes(6);
    expect(sent.some((s) => /حدّك اليومي/.test(s.text))).toBe(false);
  });
});

describe("what the model is told, and Sham", () => {
  it("the system prompt (user and owner) says media is open to everyone and never owners-only", () => {
    for (const owner of [false, true]) {
      const p = coderSystemPrompt({ github: false, notes: "", owner });
      expect(p).toMatch(/open to EVERY user/);
      expect(p).toMatch(/Never say that media generation is for owners only/);
    }
  });
  it("Sham and Sham v2 stay owner-only until the owner flips each one's own expose switch", () => {
    process.env.MODELSCOPE_API_TOKEN = "ms";
    const models = DEFAULT_MODELS.map((m) => ({ ...m }));
    for (const id of ["sham", "sham_v2"]) {
      expect(models.find((m) => m.id === id)!.visible).toBe(false);
      expect(chooseModel({ mode: "coder" }, models, id, false)).toBe(false);          // a normal user cannot pick it
      expect(chooseModel({ mode: "coder" }, models, id, true)).toBe(true);            // the owner can
    }
    models.find((m) => m.id === "sham_v2")!.visible = true;                            // only v2's own toggle
    expect(chooseModel({ mode: "coder" }, models, "sham_v2", false)).toBe(true);
    expect(chooseModel({ mode: "coder" }, models, "sham", false)).toBe(false);          // old Sham still owner-only
    expect(chooseModel({ mode: "coder" }, models, "coder", false)).toBe(true);          // Nova is public
  });
});
