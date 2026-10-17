jest.mock("@/lib/prisma", () => ({ prisma: {} }));
import { deriveAtomic, formatAtomic, findPayment, receiveAddress, availableChains } from "@/lib/chainDeposits";

describe("deriveAtomic", () => {
  it("USDT: requested dollars plus a sub-cent suffix", () => {
    const a = deriveAtomic("USDT_TRC20", 10, 1, () => 0);
    expect(a).toBe(10_000_000 + 1); // 10.000001
    const b = deriveAtomic("USDT_TRC20", 10, 1, () => 0.9999);
    expect(b).toBeGreaterThan(10_000_000);
    expect(b).toBeLessThan(10_010_000);
  });
  it("TRX: converts at the given rate, suffix below one cent step", () => {
    const a = deriveAtomic("TRX", 10, 0.25, () => 0); // 40 TRX
    expect(a).toBe(40_000_000 + 1);
  });
  it("DOGE: eight decimals, suffix below 0.001 DOGE", () => {
    const a = deriveAtomic("DOGE", 10, 0.2, () => 0.5); // 50 DOGE
    expect(a).toBeGreaterThan(50 * 1e8);
    expect(a - 50 * 1e8).toBeLessThan(100_000);
  });
  it("never rounds a request to zero", () => expect(deriveAtomic("DOGE", 0.0000001, 1000, () => 0)).toBeGreaterThan(0));
});

describe("formatAtomic", () => {
  it("prints exact decimals", () => {
    expect(formatAtomic("USDT_TRC20", 10_000_001)).toBe("10.000001");
    expect(formatAtomic("TRX", 999)).toBe("0.000999");
    expect(formatAtomic("DOGE", 5_000_000_123)).toBe("50.00000123");
  });
});

describe("findPayment", () => {
  const req = { id: "r", chain: "USDT_TRC20" as const, atomic: 10_000_123, createdMs: 1_000_000 };
  const t = (hash: string, atomic: number, tsMs: number) => ({ hash, atomic, tsMs });
  it("matches only the exact amount", () => {
    expect(findPayment(req, [t("a", 10_000_000, 2_000_000), t("b", 10_000_123, 2_000_000)], new Set())?.hash).toBe("b");
    expect(findPayment(req, [t("a", 10_000_124, 2_000_000)], new Set())).toBeNull();
  });
  it("ignores transfers from before the request", () => expect(findPayment(req, [t("old", 10_000_123, 500_000)], new Set())).toBeNull());
  it("tolerates two minutes of clock slack", () => expect(findPayment(req, [t("x", 10_000_123, 1_000_000 - 100_000)], new Set())?.hash).toBe("x"));
  it("never reuses a hash already credited", () => expect(findPayment(req, [t("a", 10_000_123, 2_000_000)], new Set(["a"]))).toBeNull());
});

describe("receiveAddress", () => {
  const keep = { ...process.env };
  afterEach(() => { process.env = { ...keep }; });
  it("is closed until an address is configured, and rejects malformed ones", () => {
    delete process.env.DEPOSIT_TRON_ADDRESS; delete process.env.USDT_ADDRESS; delete process.env.DEPOSIT_DOGE_ADDRESS;
    expect(availableChains()).toEqual([]);
    process.env.DEPOSIT_TRON_ADDRESS = "not-valid";
    expect(receiveAddress("TRX")).toBeNull();
  });
  it("accepts well-formed TRON and DOGE addresses", () => {
    process.env.DEPOSIT_TRON_ADDRESS = "TSVES7iRYHCrGbJ9UzJzxypDXQY65KTgsn";
    process.env.DEPOSIT_DOGE_ADDRESS = "DRSfTbqVgXdLrndceTdQC9mFFhvtzf5WBz";
    expect(availableChains().sort()).toEqual(["DOGE", "TRX", "USDT_TRC20"]);
  });
});
