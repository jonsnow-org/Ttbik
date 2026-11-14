import { detectChannelPayoutNetwork, isValidTonPayoutAddress, isValidTronPayoutAddress, isValidTronTransactionHash } from "@/lib/channels/payoutAddress";

describe("channel payout address validation", () => {
  it("accepts a valid TRON Base58Check address and rejects a checksum mutation", () => {
    const valid = "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb";
    expect(isValidTronPayoutAddress(valid)).toBe(true);
    expect(isValidTronPayoutAddress(valid.slice(0, -1) + "A")).toBe(false);
    expect(detectChannelPayoutNetwork(valid)).toBe("USDT-TRC20");
  });
  it("accepts a valid TON friendly address only when its CRC is intact", () => {
    const valid = "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c";
    expect(isValidTonPayoutAddress(valid)).toBe(true);
    expect(isValidTonPayoutAddress(valid.slice(0, -1) + "d")).toBe(false);
    expect(detectChannelPayoutNetwork(valid)).toBe("TON");
  });
  it("rejects malformed and length-only strings", () => {
    expect(detectChannelPayoutNetwork("T" + "a".repeat(33))).toBeNull();
    expect(detectChannelPayoutNetwork("UQ" + "a".repeat(46))).toBeNull();
  });
  it("validates TRON transaction IDs", () => {
    expect(isValidTronTransactionHash("a".repeat(64))).toBe(true);
    expect(isValidTronTransactionHash("g".repeat(64))).toBe(false);
    expect(isValidTronTransactionHash("a".repeat(63))).toBe(false);
  });
});
