import { postShamContinuation } from "@/lib/shamContinuation";

describe("Sham continuation handoff", () => {
  const url = "https://example.test/api/sham/continue";
  const body = JSON.stringify({ botId: "bot", chatId: "42#sham-task", chain: "sham1", sig: "signed" });

  it("accepts a handoff only when the continuation route returns 202", async () => {
    const fetcher = jest.fn().mockResolvedValue({ status: 202 }) as unknown as typeof fetch;
    await expect(postShamContinuation(url, body, fetcher, 1000)).resolves.toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledWith(url, expect.objectContaining({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      cache: "no-store",
      signal: expect.anything(),
    }));
  });

  it.each([200, 401, 500])("surfaces HTTP %s instead of pretending the handoff succeeded", async (status) => {
    const fetcher = jest.fn().mockResolvedValue({ status }) as unknown as typeof fetch;
    await expect(postShamContinuation(url, body, fetcher, 1000)).resolves.toEqual({
      ok: false,
      uncertain: false,
      reason: `HTTP ${status}`,
    });
  });

  it("reports a network failure as unconfirmed without retrying a possibly accepted POST", async () => {
    const fetcher = jest.fn().mockRejectedValue(new Error("connection reset")) as unknown as typeof fetch;
    await expect(postShamContinuation(url, body, fetcher, 1000)).resolves.toEqual({
      ok: false,
      uncertain: true,
      reason: "connection reset",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
