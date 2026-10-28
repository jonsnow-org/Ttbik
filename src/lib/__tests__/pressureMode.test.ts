// Owner-only pressure mode: smaller media, halved FREE limits, overflow Studio first, least-queued Nova Studio; owner / paid plans untouched; only the owner can flip it.
import { appOp } from "@/lib/coderApp";
import { refreshPressure, setPressure, pressureOn, pressureLimit, pressureMedia, _setPressureForTests } from "@/lib/pressureMode";
import { reserveMedia, mediaLimit } from "@/lib/coderMedia";
import { usageSummary, setSubscription } from "@/lib/coderPlans";
import { novaMakeMedia } from "@/lib/novaMedia";
import { orderV2, _resetPoolForTests, _verifyForTests } from "@/lib/shamPool";
import { fakeBot } from "./coderFakes";
import { pgDb, resetPg } from "./pgDb";

const botRow = { id: "bot1", token: "T", webhookSecret: "whs", isActive: true, template: "NOVA_BOT" } as any;
const owner = { chatId: 1, tier: "owner" as const }, user = { chatId: 50, tier: "user" as const };
beforeEach(async () => { await resetPg(); _setPressureForTests(false); process.env.SUPER_ADMIN_TELEGRAM_ID = "1"; process.env.CODER_TOKEN_KEY = "k"; });
afterAll(() => _setPressureForTests(false));

describe("the switch", () => {
  it("only the owner reads or sets it; the value is shared through the database", async () => {
    const d: any = pgDb(); const { bot } = fakeBot();
    await expect(appOp(user, "pressure", { on: true }, { db: d, bot, botRow })).rejects.toMatchObject({ status: 403 });
    expect(await appOp(owner, "pressure", {}, { db: d, bot, botRow })).toEqual({ on: false });
    expect(await appOp(owner, "pressure", { on: true }, { db: d, bot, botRow })).toEqual({ on: true });
    _setPressureForTests(false);                                          // another instance with a stale cache
    expect(await refreshPressure(d, true)).toBe(true);
    expect(await appOp(owner, "pressure", { on: false }, { db: d, bot, botRow })).toEqual({ on: false });
    expect(pressureOn()).toBe(false);
  });
});

describe("what it changes", () => {
  it("media gets smaller", async () => {
    expect(pressureMedia()).toEqual({ imageSize: 512, videoSeconds: 2 });
    _setPressureForTests(true);
    expect(pressureMedia()).toEqual({ imageSize: 384, videoSeconds: 1 });
    const bodies: any[] = [];
    const f = (async (u: any, init: any) => { if (init?.body) bodies.push(JSON.parse(JSON.parse(init.body).body)); return new Response(JSON.stringify({ event_id: "e" })); }) as any;
    process.env.NOVA_MEDIA_STUDIO_URL = "https://m.test";
    await novaMakeMedia("image", "a horse", { fetchImpl: f, attempts: 1 }).catch(() => null);
    await novaMakeMedia("video", "a horse", { fetchImpl: f }).catch(() => null);
    const img = bodies.find((b) => b.prompt && b.seed !== undefined && b.seconds === undefined);
    const vid = bodies.find((b) => b.seconds !== undefined);
    expect(img).toBeTruthy(); expect(img.size).toBe(384);
    expect(vid).toBeTruthy(); expect(vid.seconds).toBe(1);
  });
  it("the FREE plan's limits are halved; paid plans and the owner are untouched", async () => {
    const d: any = pgDb();
    const base = mediaLimit("free", "image");
    expect(pressureLimit(10, "free")).toBe(10);
    _setPressureForTests(true);
    expect(pressureLimit(10, "free")).toBe(5);
    expect(pressureLimit(1, "free")).toBe(1);
    expect(pressureLimit(-1, "free")).toBe(-1);
    expect(pressureLimit(10, "plus")).toBe(10);
    const slot = await reserveMedia(77, "image", d);
    expect(slot.limit).toBe(Math.max(1, Math.floor(base / 2)));
    await setSubscription(78, "plus", 30, "t", d);
    expect((await reserveMedia(78, "image", d)).limit).toBe(mediaLimit("plus", "image"));
    expect((await reserveMedia(1, "image", d)).limit).toBe(-1);
    const free = await usageSummary(77, d);
    const plus = await usageSummary(78, d);
    _setPressureForTests(false);
    const freeNormal = await usageSummary(77, d);
    const t = (s: any) => s.metrics.find((m: any) => m.metric === "tasks").limit;
    expect(t(free)).toBeLessThan(t(freeNormal));
    expect(t(plus)).toBe(t(await usageSummary(78, d)));
  });
  it("Sham v2: the overflow Studio goes first", () => {
    _resetPoolForTests();
    const P = "https://studio-novaai2026-sham-v2-server.api-inference.modelscope.net", O = "https://studio-novaai2026-nova-inference-server.api-inference.modelscope.net";
    process.env.SHAM_V2_OVERFLOW_URL = O; _verifyForTests(O, true);
    expect(orderV2([P])).toEqual([P, O]);                                  // idle, switch off: the primary
    _setPressureForTests(true);
    expect(orderV2([P])).toEqual([O, P]);
  });
});
