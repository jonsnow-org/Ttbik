// The queue to the public node: identical questions are asked once, a long queue serves older answers, a huge one refuses.
process.env.TONCENTER_API_KEY = "test";          // short gap between calls
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { cached, isBusy } = require("../web/lib/chain");

describe("chain cache under crowd", () => {
  it("asks the same question once for many visitors", async () => {
    let calls = 0;
    const r = await Promise.all(Array.from({ length: 30 }, () => cached("same", 5000, async () => { calls++; return 7; })));
    expect(r.every((x) => x === 7)).toBe(true);
    expect(calls).toBe(1);
  });
  it("serves an old answer when the queue is long, and refuses when it is huge", async () => {
    await cached("old", 1, async () => "stale");
    await new Promise((r) => setTimeout(r, 10));                     // now expired
    let calls = 0;
    const slow = Array.from({ length: 70 }, (_, i) => cached(`k${i}`, 5000, async () => { calls++; return i; }).catch((e: unknown) => (isBusy(e) ? "busy" : "err")));
    const stale = await cached("old", 1, async () => "fresh");       // queue is long: the old answer comes back at once
    expect(stale).toBe("stale");
    const res = await Promise.all(slow);
    expect(res.filter((x) => x === "busy").length).toBeGreaterThan(0);
    expect(res.filter((x) => x === "err").length).toBe(0);
    expect(calls).toBeLessThanOrEqual(61);
  }, 60000);
});
