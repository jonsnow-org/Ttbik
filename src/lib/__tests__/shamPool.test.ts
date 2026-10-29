// Sham v2 overflow Studio: the primary first; the overflow takes new calls while the primary is congested (in flight / slow / just failed); busy or unreachable primary
// hands the call over at once; Nova's Studios and Sham v1 are never in the pool.
import { shamBases, shamVariant, shamThink } from "@/lib/shamStudio";
import { DEFAULT_V2_OVERFLOW_URL, _resetPoolForTests, _verifyForTests, congested, orderV2, overflowConfigured, overflowVerdict, refreshOverflow, tracked } from "@/lib/shamPool";

const PRIMARY = "https://studio-novaai2026-sham-v2-server.api-inference.modelscope.net";
const OVER = DEFAULT_V2_OVERFLOW_URL;
const v2 = <T,>(f: () => T) => shamVariant.run("v2", f);
const v1 = <T,>(f: () => T) => shamVariant.run("v1", f);
beforeEach(() => {
  _resetPoolForTests(); _verifyForTests(OVER);                              // (the verification itself is tested below)
  delete process.env.SHAM_V2_URL; delete process.env.SHAM_V2_OVERFLOW_URL; delete process.env.SHAM_MODELSCOPE_URL;
  delete process.env.SHAM_V2_PRIMARY_MAX_INFLIGHT; delete process.env.SHAM_V2_SLOW_MS; delete process.env.SHAM_V2_COOLDOWN_MS;
  process.env.MODELSCOPE_API_TOKEN = "t";
});

describe("routing order", () => {
  it("idle primary: primary first, overflow only as the fallback", () => {
    expect(v2(() => shamBases())).toEqual([PRIMARY, OVER]);
  });
  it("primary congested (a call in flight): the NEW request goes to the overflow first", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const inflight = tracked(PRIMARY, () => gate);
    expect(congested(PRIMARY)).toBe(true);
    expect(v2(() => shamBases())).toEqual([OVER, PRIMARY]);
    release(); await inflight;
    expect(v2(() => shamBases())).toEqual([PRIMARY, OVER]);                    // the queue drained: back to the primary
  });
  it("primary slow (average latency over the threshold) or just failed: overflow first; after the cooldown it returns", async () => {
    process.env.SHAM_V2_SLOW_MS = "10"; process.env.SHAM_V2_COOLDOWN_MS = "50";
    await tracked(PRIMARY, () => new Promise((r) => setTimeout(r, 40)));
    expect(v2(() => shamBases())[0]).toBe(OVER);
    _resetPoolForTests(); _verifyForTests(OVER);
    await tracked(PRIMARY, async () => null, (r) => r === null);                // refused / unreachable
    expect(v2(() => shamBases())[0]).toBe(OVER);
    await new Promise((r) => setTimeout(r, 70));
    expect(v2(() => shamBases())[0]).toBe(PRIMARY);
  });
  it("both congested: primary first (overflow last); overflow can be switched off", () => {
    const now = Date.now();
    h(PRIMARY); h(OVER);
    function h(b: string) { void tracked(b, () => new Promise(() => undefined)); }       // never finishes: both stay in flight
    expect(orderV2([PRIMARY], now)).toEqual([PRIMARY, OVER]);
    process.env.SHAM_V2_OVERFLOW_URL = "off";
    expect(v2(() => shamBases())).toEqual([PRIMARY]);
  });
  it("Sham v1 and Sham v2 never route through Nova-owned endpoints, even when configured as the overflow", async () => {
    expect(v1(() => shamBases())).toEqual(["https://studio-novaai2026-sham-v1-server.api-inference.modelscope.net"]);
    process.env.SHAM_MODELSCOPE_URL = "https://studio-novaai2026-nova-inference-server.api-inference.modelscope.net";
    process.env.SHAM_V2_OVERFLOW_URL = "https://studio-novaai2026-nova-inference-server.api-inference.modelscope.net";
    expect(overflowConfigured()).toBe(DEFAULT_V2_OVERFLOW_URL);
    expect(v1(() => shamBases()).some((b) => /nova-inference-server/.test(b))).toBe(false);
    expect(v2(() => shamBases()).some((b) => /nova-inference-server|coder-inference|nova-media/.test(b))).toBe(false);
    expect(await refreshOverflow("https://studio-novaai2026-nova-inference-server.api-inference.modelscope.net", async () => { throw new Error("must not be called"); })).toBe(false);
    expect(overflowVerdict().why).toContain("cross-model");
  });
});

describe("a real call under simulated congestion", () => {
  const sse = (o: object) => `event: complete\ndata: [${JSON.stringify(JSON.stringify(o))}]\n`;
  function net(primary: "slow" | "busy" | "down" | "ok") {
    const hits: string[] = [];
    (global as any).fetch = jest.fn(async (url: string) => {
      const host = url.includes("sham-v2-overflow-server") ? "overflow" : "primary";
      if (url.includes("/call/v2/")) hits.push(host);
      if (host === "primary" && primary === "down") throw new TypeError("fetch failed");
      if (url.includes("/call/v2/")) return new Response(JSON.stringify({ event_id: "e1" }), { status: 200 });
      const reply = host === "primary" && primary === "busy" ? { type: "busy", text: "busy" } : { type: "text", text: `answer from ${host}` };
      return new Response(sse(reply), { status: 200 });
    });
    return hits;
  }
  it("healthy primary answers; busy primary hands over to the overflow in the same call; unreachable too", async () => {
    let hits = net("ok");
    expect((await v2(() => shamThink("hi", "u", null, 40, 20000))).reply?.text).toBe("answer from primary");
    expect(hits).toEqual(["primary"]);
    _resetPoolForTests(); _verifyForTests(OVER); hits = net("busy");
    expect((await v2(() => shamThink("hi", "u", null, 40, 20000))).reply?.text).toBe("answer from overflow");
    expect(hits).toEqual(["primary", "overflow"]);
    _resetPoolForTests(); _verifyForTests(OVER); hits = net("down");
    expect((await v2(() => shamThink("hi", "u", null, 40, 20000))).reply?.text).toBe("answer from overflow");
    expect(hits).toEqual(["primary", "overflow"]);
    hits = net("down");                                                         // cooled down: the next call goes straight to the overflow
    expect((await v2(() => shamThink("again", "u", null, 40, 20000))).reply?.text).toBe("answer from overflow");
    expect(hits).toEqual(["overflow"]);
  });
  it("concurrent calls spread: while the first holds the primary, the second goes to the overflow", async () => {
    const hits: string[] = [];
    let unlock!: () => void;
    const gate = new Promise<void>((r) => (unlock = r));
    (global as any).fetch = jest.fn(async (url: string) => {
      const host = url.includes("sham-v2-overflow-server") ? "overflow" : "primary";
      if (url.includes("/call/v2/")) { hits.push(host); return new Response(JSON.stringify({ event_id: "e1" }), { status: 200 }); }
      if (host === "primary") await gate;                                       // the primary is slow to answer
      return new Response(sse({ type: "text", text: `answer from ${host}` }), { status: 200 });
    });
    const first = v2(() => shamThink("one", "u", null, 40, 20000));
    await new Promise((r) => setTimeout(r, 30));
    const second = await v2(() => shamThink("two", "u", null, 40, 20000));
    expect(second.reply?.text).toBe("answer from overflow");
    unlock();
    expect((await first).reply?.text).toBe("answer from primary");
    expect(hits).toEqual(["primary", "overflow"]);
  });
});

describe("the overflow Studio is used only after it proves it runs Sham v2", () => {
  const status = (o: object) => (async (url: string) => (url.includes("/call/v2/") ? new Response(JSON.stringify({ event_id: "s" }), { status: 200 }) : new Response(`event: complete\ndata: [${JSON.stringify(JSON.stringify(o))}]\n`, { status: 200 }))) as unknown as typeof fetch;
  it("not verified (never checked, an old Sham copy that reports another model or none, not ready, unreachable): never in the order", async () => {
    _resetPoolForTests();
    expect(v2(() => shamBases())).toEqual([PRIMARY]);
    expect(await refreshOverflow(OVER, status({ phase: "ready" }))).toBe(false);                               // the stale copy: no model field
    expect(overflowVerdict().why).toMatch(/unreported/);
    expect(await refreshOverflow(OVER, status({ phase: "ready", model: "novaai2026/sham-merged" }))).toBe(false);
    expect(await refreshOverflow(OVER, status({ phase: "loading", model: "novaai2026/sham-v2" }))).toBe(false);
    expect(await refreshOverflow(OVER, (async () => { throw new Error("down"); }) as any)).toBe(false);
    expect(overflowVerdict().ok).toBe(false);
  });
  it("verified (ready + sham-v2): in the order", async () => {
    _resetPoolForTests();
    expect(await refreshOverflow(OVER, status({ phase: "ready", model: "novaai2026/sham-v2" }))).toBe(true);
    expect(v2(() => shamBases())).toEqual([PRIMARY, OVER]);
  });
});
