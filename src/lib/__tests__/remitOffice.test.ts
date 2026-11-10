import { fmt, newTrack, parseAmount, parseCallback, receiptText } from "@/lib/remit/office";
import { coinById, estimate, createExchange, exchangeStatus, PAY_COINS, TRON_ADDRESS } from "@/lib/remit/changenow";
import { parseRefCommand } from "@/lib/remit/refLinks";

jest.mock("@/lib/prisma", () => ({ prisma: {} }));

describe("remittance office", () => {
  it("reads amounts the way people type them", () => {
    expect(parseAmount("100")).toBe(100);
    expect(parseAmount("0,005")).toBe(0.005);
    expect(parseAmount("١٥٠")).toBe(150);
    expect(parseAmount("$ 25.5")).toBe(25.5);
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("0")).toBeNull();
  });
  it("makes unguessable tracking numbers and short callbacks", () => {
    const t = newTrack();
    expect(t).toMatch(/^HW-[A-Z2-9]{10}$/);
    expect(newTrack()).not.toBe(t);
    const addr = "TSVES7iRYHCrGbJ9UzJzxypDXQY65KTgsn";
    expect(TRON_ADDRESS.test(addr)).toBe(true);
    expect(Buffer.byteLength(`ro:del:${addr}`)).toBeLessThanOrEqual(64);
    expect(parseCallback(`ro:to:${addr}`)).toEqual({ a: "to", v: addr });
    expect(parseCallback("approve:ADV-1")).toBeNull();
  });
  it("has unique pay coins and a readable receipt without the sender", () => {
    expect(new Set(PAY_COINS.map((c) => c.id)).size).toBe(PAY_COINS.length);
    const txt = receiptText({ track: "HW-ABCDEFGHJK", from_country: "tr", to_country: "sy", from_amount: 100, coin: "usdtbsc", to_amount: 98.4567, address: "TSVES7iRYHCrGbJ9UzJzxypDXQY65KTgsn", recipient: "أمي", status: "sending" }, "https://x.dev/");
    expect(txt).toContain("🇹🇷 تركيا ← 🇸🇾 سوريا");
    expect(txt).toContain("≈ 98.46 USDT (TRC20)");
    expect(txt).toContain("https://x.dev/remit/r/HW-ABCDEFGHJK");
    expect(fmt(0.1 + 0.2)).toBe("0.3");
  });
  it("calls the partner API with the key, the TRC20 payout and the tracking ref", async () => {
    const calls: { url: string; init: any }[] = [];
    const f = (async (url: string, init: any) => {
      calls.push({ url, init });
      const body = url.includes("/exchange/by-id") ? { status: "finished", amountTo: 98, payoutHash: "abc" } : url.includes("estimated") ? { toAmount: 98.5 } : { id: "cn1", payinAddress: "0xPAY", payinExtraId: null, fromAmount: 100, toAmount: 98.5 };
      return { ok: true, text: async () => JSON.stringify(body) } as any;
    }) as any;
    const c = coinById("usdtbsc")!;
    expect((await estimate("K", c, 100, f)).toAmount).toBe(98.5);
    expect(calls[0].url).toContain("toNetwork=trx");
    expect(calls[0].init.headers["x-changenow-api-key"]).toBe("K");
    const ex = await createExchange("K", c, 100, "TSVES7iRYHCrGbJ9UzJzxypDXQY65KTgsn", "HW-ABCDEFGHJK", f);
    expect(ex.payinAddress).toBe("0xPAY");
    const sent = JSON.parse(calls[1].init.body);
    expect(sent).toMatchObject({ fromCurrency: "usdt", fromNetwork: "bsc", toCurrency: "usdt", toNetwork: "trx", address: "TSVES7iRYHCrGbJ9UzJzxypDXQY65KTgsn", flow: "standard" });
    expect((await exchangeStatus("K", "cn1", f)).status).toBe("finished");
  });
  it("lets the platform set the API key from Telegram", () => {
    expect(parseRefCommand("/ref CHANGENOW_API abcdef0123456789abcdef")).toEqual({ kind: "set", key: "CHANGENOW_API", url: "abcdef0123456789abcdef" });
    expect(parseRefCommand("/ref CHANGENOW_API x")?.kind).toBe("error");
  });
});
