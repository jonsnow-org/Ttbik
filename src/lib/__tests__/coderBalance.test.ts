import { coderChat } from "@/lib/openCoderStudio";

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; delete process.env.OPEN_CODER_STUDIO_URL; delete process.env.OPEN_CODER_STUDIO_URLS; delete process.env.CODER_STUDIO_BALANCE; });

function studios(status: Record<string, Record<string, unknown> | "down">, hits: string[]) {
  global.fetch = (async (u: any) => {
    const url = String(u);
    hits.push(url);
    const base = url.slice(0, url.indexOf("/gradio_api"));
    const api = url.includes("/status") ? "status" : "chat";
    if (status[base] === "down") throw new TypeError("fetch failed");
    if (url.includes("/call/v2/")) return Response.json({ event_id: `${api}-e` });
    const body = api === "status" ? status[base] : { type: "pending", job: "j1" };
    return new Response(`data: ${JSON.stringify([JSON.stringify(body)])}\n`);
  }) as typeof fetch;
}
const chats = (hits: string[]) => hits.filter((h) => h.includes("/call/v2/chat")).map((h) => h.slice(0, h.indexOf("/gradio_api")));

describe("both Studios serve (idle one first)", () => {
  beforeEach(() => { process.env.OPEN_CODER_STUDIO_URL = "https://a.example"; process.env.OPEN_CODER_STUDIO_URLS = "https://b.example"; });
  it("the primary is busy, the replica idle: the completion goes to the replica", async () => {
    const hits: string[] = [];
    studios({ "https://a.example": { phase: "ready", queue: 2 }, "https://b.example": { phase: "ready", queue: 0 } }, hits);
    const o = await coderChat([{ role: "user", content: "hi" }], { waitS: 1 });
    expect(chats(hits)).toEqual(["https://b.example"]);
    expect(o.reply?.job).toBe("s1~j1");
  });
  it("both idle: the primary keeps it", async () => {
    const hits: string[] = [];
    studios({ "https://a.example": { phase: "ready", queue: 0 }, "https://b.example": { phase: "ready", queue: 0 } }, hits);
    expect((await coderChat([{ role: "user", content: "hi" }], { waitS: 1 })).reply?.job).toBe("j1");
  });
  it("a Studio still loading goes last", async () => {
    const hits: string[] = [];
    studios({ "https://a.example": { phase: "loading", queue: 0 }, "https://b.example": { phase: "ready", queue: 1 } }, hits);
    await coderChat([{ role: "user", content: "hi" }], { waitS: 1 });
    expect(chats(hits)[0]).toBe("https://b.example");
  });
  it("CODER_STUDIO_BALANCE=off: no status probe, primary first", async () => {
    process.env.CODER_STUDIO_BALANCE = "off";
    const hits: string[] = [];
    studios({ "https://a.example": { phase: "ready", queue: 5 }, "https://b.example": { phase: "ready", queue: 0 } }, hits);
    await coderChat([{ role: "user", content: "hi" }], { waitS: 1 });
    expect(hits.some((h) => h.includes("status"))).toBe(false);
    expect(chats(hits)).toEqual(["https://a.example"]);
  });
});

describe("Studio status", () => {
  it("is read although it carries no `type` (it used to come back null, so quiet-time work always saw 'studio busy or down')", async () => {
    const { coderStatus, parseStatusSse } = await import("@/lib/openCoderStudio");
    expect(parseStatusSse(`data: ${JSON.stringify([JSON.stringify({ phase: "ready", queue: 0 })])}\n`)).toEqual({ phase: "ready", queue: 0 });
    process.env.OPEN_CODER_STUDIO_URL = "https://a.example";
    studios({ "https://a.example": { phase: "ready", queue: 0, model: "m" } }, []);
    expect(await coderStatus(2000)).toMatchObject({ phase: "ready", queue: 0 });
  });
});
