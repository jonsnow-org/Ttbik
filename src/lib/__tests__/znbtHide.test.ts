// ZNBt moderation: the hide challenge and owner check (pure; the database is not touched here).
import { describe, it, expect } from "vitest";
import { Address } from "@ton/core";
import { makeHidePayload, readHidePayload, isOwnerAddress, validCurve, OWNER_WALLET } from "../znbtHide";

describe("hide challenge", () => {
  it("round-trips, rejects tampering, another secret and expiry", () => {
    const p = makeHidePayload("secret-1", 1_000_000_000_000);
    expect(readHidePayload("secret-1", p, 1_000_000_000_000 + 60_000)).toBe(true);
    expect(readHidePayload("secret-2", p, 1_000_000_000_000 + 60_000)).toBe(false);
    expect(readHidePayload("secret-1", p.replace(/.$/, (c) => (c === "0" ? "1" : "0")), 1_000_000_000_000 + 60_000)).toBe(false);
    expect(readHidePayload("secret-1", p, 1_000_000_000_000 + 20 * 60_000)).toBe(false);
    expect(readHidePayload("secret-1", "", 1)).toBe(false);
  });
  it("fits in the 128 bytes a wallet allows for a ton_proof payload", () => {
    expect(Buffer.byteLength(makeHidePayload("s"))).toBeLessThan(128);
  });
});

describe("owner and coin addresses", () => {
  it("accepts the owner wallet in any format and nobody else", () => {
    const a = Address.parse(OWNER_WALLET);
    expect(isOwnerAddress(OWNER_WALLET)).toBe(true);
    expect(isOwnerAddress(a.toRawString())).toBe(true);
    expect(isOwnerAddress(a.toString({ bounceable: true }))).toBe(true);
    expect(isOwnerAddress("EQCfB-x6kjzhc-cpSm7Hsw1StrYHaWj7ka06Pld1hRYPpVxc")).toBe(false);
    expect(isOwnerAddress("not an address")).toBe(false);
  });
  it("normalises coin addresses and rejects garbage", () => {
    const raw = Address.parse("EQCfB-x6kjzhc-cpSm7Hsw1StrYHaWj7ka06Pld1hRYPpVxc").toRawString();
    expect(validCurve(raw)).toBe("EQCfB-x6kjzhc-cpSm7Hsw1StrYHaWj7ka06Pld1hRYPpVxc");
    expect(validCurve("'; drop table")).toBeNull();
  });
});
