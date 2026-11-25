import {
  memoryStore, normLink, normProject, normTargetSettings, forbidsLinks, inQuiet, handleMyChatMember, runPromoTick, pickProject, dueTargets,
  acceptComposed, templateText, textHash, newTarget, verifyTarget, LIMITS, type Target,
} from "@/lib/promoSupervisor";
import { refreshTgFeatures, setTgAudience, _resetTgFeatures } from "@/lib/tgFeatures";

process.env.SUPER_ADMIN_TELEGRAM_ID = process.env.SUPER_ADMIN_TELEGRAM_ID || "777";
const OWNER = process.env.SUPER_ADMIN_TELEGRAM_ID!.split(",")[0].trim();

// noon in Istanbul (UTC+3) = 09:00Z: outside the default quiet hours 23–9
const NOON = new Date("2026-11-25T09:00:00Z");

function fakeApi(over: Partial<Record<string, (p: any) => any>> = {}) {
  const calls: { m: string; p: any }[] = [];
  const handler = (m: string) => async (p: any) => { calls.push({ m, p }); if (over[m]) return over[m]!(p); return m === "getChat" ? { id: p.chat_id, type: "supergroup", title: "Group", description: "" } : m === "getChatMember" ? { status: "member" } : true; };
  const api: any = { raw: new Proxy({}, { get: (_t, m: string) => handler(m) }) };
  return { api, calls };
}
const ready = (over: Partial<Target> = {}): Target => ({ ...newTarget("-1001", "bot1"), title: "Group", type: "supergroup", status: "member", allowLinks: true, enabled: true, ...over });

describe("promotion supervisor: validation", () => {
  it("normalises links and refuses non-https", () => {
    expect(normLink("@JobsBot")).toBe("https://t.me/JobsBot");
    expect(normLink("t.me/StoreBot")).toBe("https://t.me/StoreBot");
    expect(() => normLink("http://x.com")).toThrow("https");
    expect(() => normLink("not a link")).toThrow();
    expect(() => normProject({ title: " ", link: "@JobsBot" })).toThrow("title");
  });
  it("clamps the owner's settings to the safe ranges", () => {
    expect(normTargetSettings({ cadenceH: 1, maxPerDay: 50, quietFrom: 30 })).toEqual({ cadenceH: LIMITS.minCadenceH, maxPerDay: LIMITS.maxPerDayCap, quietFrom: 23 });
  });
  it("spots a group description that forbids links (Arabic and English)", () => {
    expect(forbidsLinks("قوانين: يمنع نشر الروابط")).toBe(true);
    expect(forbidsLinks("ممنوع الإعلانات")).toBe(true);
    expect(forbidsLinks("No links please")).toBe(true);
    expect(forbidsLinks("مجموعة للبرمجة، شاركوا مشاريعكم")).toBe(false);
  });
  it("quiet hours are read in Istanbul time, across midnight too", () => {
    expect(inQuiet(new Date("2026-11-25T21:00:00Z"), 23, 9)).toBe(true);   // 00:00 TRT
    expect(inQuiet(NOON, 23, 9)).toBe(false);                              // 12:00 TRT
    expect(inQuiet(NOON, 10, 14)).toBe(true);
  });
  it("a model text must carry only our link; a missing link is appended", () => {
    const p = { id: 1, title: "Jobs", link: "https://t.me/JobsBot", pitch: "", enabled: true };
    expect(acceptComposed("جرّب بوت الوظائف", p)).toContain("https://t.me/JobsBot");
    expect(acceptComposed("جرّب https://t.me/JobsBot و https://evil.example", p)).toBe("");
    expect(acceptComposed("تابع @someone https://t.me/JobsBot", p)).toBe("");
    expect(acceptComposed("x".repeat(LIMITS.maxText + 5), p)).toBe("");
  });
  it("templates never repeat a text already posted in the group", () => {
    const p = { id: 1, title: "Jobs", link: "https://t.me/JobsBot", pitch: "وظائف يومية", enabled: true };
    const a = templateText(p, new Set(), 0);
    const b = templateText(p, new Set([textHash(a)]), 0);
    expect(a).toContain(p.link);
    expect(b).not.toBe(a);
  });
});

describe("promotion supervisor: groups", () => {
  it("joining registers a DISABLED group with links not allowed; the owner is told only when he added it", async () => {
    const store = memoryStore(); const { api, calls } = fakeApi();
    expect(await handleMyChatMember(api, { chat: { id: -100, type: "supergroup", title: "G" }, from: { id: 999 }, new_chat_member: { status: "member" } }, "bot1", store)).toBe("registered");
    const t = (await store.target("-100"))!;
    expect([t.enabled, t.allowLinks, t.status]).toEqual([false, false, "member"]);
    expect(calls.filter((c) => c.m === "sendMessage")).toHaveLength(0);
    await handleMyChatMember(api, { chat: { id: -200, type: "group", title: "H" }, from: { id: Number(OWNER) }, new_chat_member: { status: "administrator" } }, "bot1", store);
    expect(calls.filter((c) => c.m === "sendMessage")).toHaveLength(1);
  });
  it("private chats are ignored; being removed disables the group", async () => {
    const store = memoryStore(); const { api } = fakeApi();
    expect(await handleMyChatMember(api, { chat: { id: 5, type: "private" }, new_chat_member: { status: "member" } }, "bot1", store)).toBe("ignored");
    await store.putTarget(ready({ chatId: "-300" }));
    await handleMyChatMember(api, { chat: { id: -300, type: "supergroup" }, from: { id: 1 }, new_chat_member: { status: "kicked" } }, "bot1", store);
    expect((await store.target("-300"))!.enabled).toBe(false);
  });
  it("verification blocks a group whose rules forbid links, or where the bot is no longer a member", async () => {
    const t = ready();
    expect((await verifyTarget(fakeApi({ getChat: () => ({ type: "supergroup", description: "يمنع نشر الروابط" }) }).api, t, 42)).ok).toBe(false);
    const gone = await verifyTarget(fakeApi({ getChatMember: () => ({ status: "left" }) }).api, t, 42);
    expect([gone.ok, gone.t.enabled]).toEqual([false, false]);
    expect((await verifyTarget(fakeApi().api, t, 42)).ok).toBe(true);
  });
});

describe("promotion supervisor: the tick", () => {
  const on = async () => true;
  async function setup(n = 2) {
    const store = memoryStore();
    for (let i = 1; i <= n; i++) await store.addProject({ title: `P${i}`, link: `https://t.me/Bot${i}`, pitch: `pitch ${i}`, enabled: true });
    await store.putTarget(ready());
    const { api, calls } = fakeApi();
    return { store, api, calls, apiFor: async () => ({ api, botUserId: 42 }) };
  }

  it("is silent while the switch is off", async () => {
    const s = await setup();
    expect((await runPromoTick({ store: s.store, now: NOON, on: async () => false, apiFor: s.apiFor, compose: null })).result).toBe("off");
    expect(s.calls).toHaveLength(0);
  });
  it("posts ONE message, logs it, and schedules the next post after the cadence", async () => {
    const s = await setup();
    const r = await runPromoTick({ store: s.store, now: NOON, on, apiFor: s.apiFor, compose: null, random: () => 0 });
    expect(r.result).toBe("sent");
    expect(s.calls.filter((c) => c.m === "sendMessage")).toHaveLength(1);
    const t = (await s.store.target("-1001"))!;
    expect(Date.parse(t.nextAt!) - NOON.getTime()).toBe(LIMITS.defCadenceH * 3600_000);
    expect(s.store._logs.find((l) => l.status === "sent")!.composer).toBe("template");
  });
  it("respects the global gap, the cadence and quiet hours", async () => {
    const s = await setup();
    await runPromoTick({ store: s.store, now: NOON, on, apiFor: s.apiFor, compose: null });
    expect((await runPromoTick({ store: s.store, now: new Date(NOON.getTime() + 60000), on, apiFor: s.apiFor, compose: null })).result).toBe("gap");
    expect((await runPromoTick({ store: s.store, now: new Date(NOON.getTime() + 3600_000), on, apiFor: s.apiFor, compose: null })).result).toBe("idle");
    const night = memoryStore(); await night.addProject({ title: "P", link: "https://t.me/P1", pitch: "", enabled: true }); await night.putTarget(ready());
    expect((await runPromoTick({ store: night, now: new Date("2026-11-25T22:00:00Z"), on, apiFor: s.apiFor, compose: null })).result).toBe("idle");
  });
  it("never posts where links are not confirmed or the group is disabled", async () => {
    const s = await setup();
    await s.store.putTarget(ready({ allowLinks: false }));
    expect((await runPromoTick({ store: s.store, now: NOON, on, apiFor: s.apiFor, compose: null })).result).toBe("idle");
    await s.store.putTarget(ready({ enabled: false }));
    expect((await runPromoTick({ store: s.store, now: new Date(NOON.getTime() + 60000), on, apiFor: s.apiFor, compose: null })).result).toBe("idle");
  });
  it("rotates projects and does not repeat one in the same group within the dedup window", async () => {
    const s = await setup(2);
    let now = NOON.getTime();
    const posted: number[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await runPromoTick({ store: s.store, now: new Date(now), on, apiFor: s.apiFor, compose: null, random: () => 0 });
      if (r.result === "sent") posted.push(r.projectId!);
      now += 25 * 3600_000;
    }
    expect(posted.slice(0, 2).sort()).toEqual([1, 2]);
    expect(posted).toHaveLength(2);                        // the third day: both were posted within 7 days -> nothing
  });
  it("uses the model text when it passes the checks", async () => {
    const s = await setup(1);
    await runPromoTick({ store: s.store, now: NOON, on, apiFor: s.apiFor, compose: async () => "بوت رائع للتجربة https://t.me/Bot1", random: () => 0 });
    expect(s.store._logs.find((l) => l.status === "sent")!.composer).toBe("nova");
  });
  it("a 429 pauses everything; a kick disables the group", async () => {
    const s = await setup(1);
    const err: any = Object.assign(new Error("Too Many Requests: retry after 120"), { parameters: { retry_after: 120 } });
    const { api } = fakeApi({ sendMessage: () => { throw err; } });
    expect((await runPromoTick({ store: s.store, now: NOON, on, apiFor: async () => ({ api, botUserId: 42 }), compose: null })).result).toBe("failed");
    expect((await runPromoTick({ store: s.store, now: new Date(NOON.getTime() + 60000), on, apiFor: async () => ({ api, botUserId: 42 }), compose: null })).result).toBe("backoff");
    const s2 = await setup(1);
    const k = fakeApi({ sendMessage: () => { throw new Error("Forbidden: bot was kicked from the supergroup chat"); } });
    await runPromoTick({ store: s2.store, now: NOON, on, apiFor: async () => ({ api: k.api, botUserId: 42 }), compose: null });
    expect((await s2.store.target("-1001"))!.enabled).toBe(false);
  });
  it("pure helpers: due targets honour the per-day limit; pickProject skips disabled projects", () => {
    const t = ready({ maxPerDay: 1 });
    const logs = [{ at: new Date(NOON.getTime() - 3600_000).toISOString(), chatId: t.chatId, projectId: 1, status: "sent" as const, text: "", note: "", composer: "", hash: "" }];
    expect(dueTargets([t], logs, NOON)).toHaveLength(0);
    expect(pickProject([{ id: 1, title: "a", link: "https://t.me/a", pitch: "", enabled: false }], t.chatId, [], NOON)).toBeNull();
  });
});

describe("promotion switch", () => {
  beforeEach(() => _resetTgFeatures());
  it("is off by default and can never be opened to everyone", async () => {
    const t = new Map<string, string>();
    const db: any = { async exec(sql: string, ...a: any[]) { if (/INSERT INTO coder_flags/.test(sql)) t.set(a[0], a[1]); }, async query(_s: string, ...keys: string[]) { return keys.filter((k) => t.has(k)).map((k) => ({ key: k, value: t.get(k)! })); } };
    expect((await refreshTgFeatures(db, true)).promo).toBe("off");
    await expect(setTgAudience("tg_promo", "all", db)).rejects.toThrow("owner only");
    await setTgAudience("tg_promo", "owner", db);
    expect((await refreshTgFeatures(db, true)).promo).toBe("owner");
  });
});

describe("promotion supervisor: one tick at a time", () => {
  it("a second tick within the hold window does nothing", async () => {
    const store = memoryStore();
    expect(await store.claimTick(1000_000, 50000)).toBe(true);
    expect(await store.claimTick(1010_000, 50000)).toBe(false);
    expect(await store.claimTick(1060_000, 50000)).toBe(true);
  });
});
