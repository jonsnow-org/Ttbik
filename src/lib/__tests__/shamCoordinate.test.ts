import { shamCoordinate, shamVariant } from "@/lib/shamStudio";

function sse(obj: unknown) {
  const chunk = new TextEncoder().encode("data: " + JSON.stringify([JSON.stringify(obj)]) + "\n");
  let sent = false;
  return {
    ok: true,
    body: { getReader: () => ({ read: async () => (sent ? { done: true, value: undefined } : ((sent = true), { done: false, value: chunk })), cancel: async () => undefined, releaseLock() {} }) },
    text: async () => "data: " + JSON.stringify([JSON.stringify(obj)]) + "\n",
  } as any;
}

describe("Sham Pro coordinator client", () => {
  const real = global.fetch;
  afterEach(() => { global.fetch = real; delete process.env.MODELSCOPE_API_TOKEN; });

  it("refuses outside the Sham Pro variant (no other model's Studio is ever asked)", async () => {
    process.env.MODELSCOPE_API_TOKEN = "t";
    let called = false;
    global.fetch = (async () => { called = true; return sse({}); }) as any;
    for (const v of ["v1", undefined] as const) {
      const r = v ? await shamVariant.run(v, () => shamCoordinate("start", { goal: "x", session: "s", owner: true })) : await shamCoordinate("start", { goal: "x", session: "s", owner: true });
      expect(r).toMatchObject({ type: "error" });
    }
    expect(called).toBe(false);
  });

  it("starts on the v2 Studio, reports which Studio took the task and sends status back to that exact Studio", async () => {
    process.env.MODELSCOPE_API_TOKEN = "t";
    const urls: string[] = [];
    global.fetch = (async (input: any, init?: any) => {
      const u = String(input);
      urls.push(u);
      if (u.includes("/call/v2/")) return { ok: true, json: async () => ({ event_id: "e1" }) } as any;
      return sse(u.includes("coordinate_start") ? { type: "coordinator", id: "abc", status: "planning", goal: "g", steps: [], log: [], files: [], error: "" } : { type: "coordinator", id: "abc", status: "done", goal: "g", steps: [], log: [], files: ["a.png"], error: "" });
    }) as any;
    const started: any = await shamVariant.run("v2", () => shamCoordinate("start", { goal: "g", session: "coord-sham_v2-1", owner: true }));
    expect(started).toMatchObject({ type: "coordinator", id: "abc" });
    expect(String(started.studio)).toMatch(/^https:\/\//);
    expect(started.studio).toContain("sham-v2-server");
    const done: any = await shamVariant.run("v2", () => shamCoordinate("status", { taskId: "abc", session: "coord-sham_v2-1", studio: started.studio }));
    expect(done.status).toBe("done");
    const statusUrl = urls.find((x) => x.includes("coordinate_status"))!;
    expect(statusUrl.startsWith(started.studio)).toBe(true);
  });
});
