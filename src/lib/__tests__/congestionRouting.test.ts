// On congestion a request goes to an idle Studio OF ITS OWN MODEL, picked by queue depth, failing over on 503 / timeouts; Nova and Sham v2 never cross.
import { coderChat, coderStudioUrls } from "@/lib/openCoderStudio";
import { shamBases, shamVariant } from "@/lib/shamStudio";
import { _resetPoolForTests, _verifyForTests, tracked, orderV2 } from "@/lib/shamPool";

const realFetch = global.fetch;
const NOVA = [1, 2, 3, 4, 5].map((i) => `https://studio-novaai2026-coder-inference-server${i === 1 ? "" : i}.api-inference.modelscope.net`);
const OVER = "https://studio-novaai2026-nova-inference-server.api-inference.modelscope.net";
afterEach(() => { global.fetch = realFetch; for (const k of ["OPEN_CODER_STUDIO_URL", "OPEN_CODER_STUDIO_URLS", "SHAM_V2_URL", "SHAM_V2_OVERFLOW_URL"]) delete process.env[k]; });

function studios(status: Record<string, Record<string, unknown> | "down" | "503">, hits: string[]) {
  global.fetch = (async (u: any) => {
    const url = String(u);
    hits.push(url);
    const base = url.slice(0, url.indexOf("/gradio_api"));
    const api = url.includes("/status") ? "status" : "chat";
    if (status[base] === "down") throw new TypeError("fetch failed");
    if (status[base] === "503") return new Response("busy", { status: 503 });
    if (url.includes("/call/v2/")) return Response.json({ event_id: `${api}-e` });
    return new Response(`data: ${JSON.stringify([JSON.stringify(api === "status" ? status[base] : { type: "pending", job: "j1" })])}\n`);
  }) as typeof fetch;
}
const chats = (hits: string[]) => hits.filter((h) => h.includes("/call/v2/chat")).map((h) => h.slice(0, h.indexOf("/gradio_api")));

describe("Nova: its own five Studios", () => {
  beforeEach(() => { process.env.OPEN_CODER_STUDIO_URL = NOVA[0]; process.env.OPEN_CODER_STUDIO_URLS = NOVA.slice(1).join(","); });
  it("two different users, the first Studios taken: each lands on an idle one; never on the Sham overflow Studio", async () => {
    const hits: string[] = [];
    const st: any = {}; NOVA.forEach((b, i) => (st[b] = { phase: "ready", queue: i < 2 ? 3 : 0 }));
    studios(st, hits);
    const a = await coderChat([{ role: "user", content: "hi" }], { waitS: 1, affinity: "user-A" } as any);
    const b = await coderChat([{ role: "user", content: "hi" }], { waitS: 1, affinity: "user-B" } as any);
    const used = chats(hits);
    expect(used).toHaveLength(2);
    expect(used.every((x) => NOVA.indexOf(x) >= 2)).toBe(true);
    expect(hits.some((h) => h.includes("nova-inference-server"))).toBe(false);
    expect(a.reply && b.reply).toBeTruthy();
  });
  it("a Studio that answers 503 / is down is skipped for the next one", async () => {
    const hits: string[] = [];
    studios({ [NOVA[0]]: "503", [NOVA[1]]: "down", [NOVA[2]]: { phase: "ready", queue: 0 }, [NOVA[3]]: { phase: "ready", queue: 1 }, [NOVA[4]]: { phase: "ready", queue: 1 } }, hits);
    const o = await coderChat([{ role: "user", content: "hi" }], { waitS: 1 });
    expect(o.reply).toBeTruthy();
    expect(chats(hits).pop()).toBe(NOVA[2]);
  });
  it("a Sham Studio in Nova's list is ignored (the models stay independent)", () => {
    process.env.OPEN_CODER_STUDIO_URLS = `${NOVA[1]},${OVER},https://studio-novaai2026-sham-v2-server.api-inference.modelscope.net`;
    expect(coderStudioUrls()).toEqual([NOVA[0], NOVA[1]]);
  });
});

describe("Sham v2: sham-v2-server, then the overflow", () => {
  it("the overflow is part of v2's order only when configured, and never a coder Studio", () => {
    process.env.SHAM_V2_URL = "https://studio-novaai2026-sham-v2-server.api-inference.modelscope.net";
    process.env.SHAM_V2_OVERFLOW_URL = "off";
    const bases = shamVariant.run("v2", () => shamBases());
    expect(bases.every((b) => !/coder-inference-server/.test(b))).toBe(true);
    expect(bases.some((b) => /nova-inference-server/.test(b))).toBe(false);
  });
  it("simulated congestion with two users: the primary is taken, the second user's call goes to the verified overflow; a failed primary is skipped", async () => {
    _resetPoolForTests();
    const P = "https://studio-novaai2026-sham-v2-server.api-inference.modelscope.net";
    process.env.SHAM_V2_URL = P; process.env.SHAM_V2_OVERFLOW_URL = OVER; _verifyForTests(OVER, true);
    expect(shamVariant.run("v2", () => orderV2([P]))[0]).toBe(P);                                  // idle: the primary first
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    const first = tracked(P, () => hold.then(() => "A"));                                          // user A's call occupies the primary
    expect(shamVariant.run("v2", () => orderV2([P]))).toEqual([OVER, P]);                          // user B: the overflow first, the primary as the fallback
    release(); await first;
    await tracked(P, async () => { throw new Error("503"); }).catch(() => null);                    // a failure puts the primary in cooldown
    expect(shamVariant.run("v2", () => orderV2([P]))[0]).toBe(OVER);
  });
});
