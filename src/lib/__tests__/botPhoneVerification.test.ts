import { waitForPhoneVerification } from "@/lib/botApp/phoneVerification";

describe("Mini App phone-verification handshake", () => {
  it("waits for the webhook-backed status instead of trusting the native popup alone", async () => {
    const read = jest.fn()
      .mockResolvedValueOnce({ ok: true, phoneVerified: false })
      .mockResolvedValueOnce({ ok: true, phoneVerified: false })
      .mockResolvedValueOnce({ ok: true, phoneVerified: true });
    const delay = jest.fn(async () => undefined);

    await expect(waitForPhoneVerification(read, { attempts: 5, intervalMs: 10, delay })).resolves.toBe(true);
    expect(read).toHaveBeenCalledTimes(3);
    expect(delay).toHaveBeenCalledTimes(2);
  });

  it("continues after a transient backend failure but never reports an unconfirmed number", async () => {
    const read = jest.fn()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce({ ok: false, phoneVerified: false })
      .mockResolvedValueOnce({ ok: true, phoneVerified: false });
    const delay = jest.fn(async () => undefined);

    await expect(waitForPhoneVerification(read, { attempts: 3, intervalMs: 1, delay })).resolves.toBe(false);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("caps polling to prevent a stuck verification screen from polling forever", async () => {
    const read = jest.fn(async () => ({ ok: true, phoneVerified: false }));
    await expect(waitForPhoneVerification(read, { attempts: 10_000, intervalMs: 0 })).resolves.toBe(false);
    expect(read).toHaveBeenCalledTimes(60);
  });
});
