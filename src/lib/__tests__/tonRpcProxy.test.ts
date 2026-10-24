// The read-only toncenter proxy used by the Palmyra Launch pages: only read methods pass, the key is added server-side and never echoed.
import { POST } from "../../app/api/ton/rpc/route";

const req = (body: unknown, ip = "1.1.1.1") => new Request("http://x/api/ton/rpc", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "x-forwarded-for": ip } }) as any;

describe("/api/ton/rpc", () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; delete process.env.TONCENTER_API_KEY; });
  it("forwards an allowed read method and adds the key", async () => {
    process.env.TONCENTER_API_KEY = "secret-key";
    const f = jest.fn(async () => new Response(JSON.stringify({ ok: true, result: 1 }), { status: 200, headers: { "content-type": "application/json" } }));
    global.fetch = f as any;
    const r = await POST(req({ id: 7, jsonrpc: "2.0", method: "runGetMethod", params: { address: "A", method: "m", stack: [] } }, "2.2.2.2"));
    expect(r.status).toBe(200);
    expect(await r.text()).not.toContain("secret-key");
    const [url, init] = f.mock.calls[0] as any;
    expect(url).toBe("https://toncenter.com/api/v2/jsonRPC");
    expect(init.headers["X-API-Key"]).toBe("secret-key");
  });
  it("refuses sending transactions and unknown methods", async () => {
    global.fetch = jest.fn() as any;
    expect((await POST(req({ method: "sendBoc", params: { boc: "x" } }, "3.3.3.3"))).status).toBe(403);
    expect((await POST(req([{ method: "runGetMethod" }], "3.3.3.4"))).status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it("rejects bad json and oversized bodies", async () => {
    expect((await POST(req("{nope", "4.4.4.4"))).status).toBe(400);
    expect((await POST(req("x".repeat(17000), "4.4.4.5"))).status).toBe(413);
  });
  it("rate limits one address", async () => {
    global.fetch = jest.fn(async () => new Response("{}", { status: 200 })) as any;
    let last = 200;
    for (let i = 0; i < 3002; i++) last = (await POST(req({ method: "getMasterchainInfo" }, "5.5.5.5"))).status;
    expect(last).toBe(429);
  });
});
