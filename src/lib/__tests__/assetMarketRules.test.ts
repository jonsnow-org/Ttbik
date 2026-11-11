import {
  ASSET_MARKET_MAX_PRICE, ASSET_MARKET_MIN_PRICE, assetIdentityProblem, assetIdentitySnapshot,
  makeAssetSaleCode, normalizeAssetIdentifier, normalizeAssetPhone, splitAssetSale,
} from "@/lib/channels/assetMarketRules";

describe("Telegram asset market identity rules", () => {
  const person = {
    id: "123456789", firstName: "Maha", lastName: "Example", username: "market_user",
    phoneNumber: "+905551112233", phoneVerified: true,
  };

  it("uses Telegram numeric ID and requires full identity plus a self-verified phone", () => {
    expect(assetIdentityProblem(person)).toBeNull();
    expect(assetIdentitySnapshot(person)).toEqual({
      telegramId: "123456789", firstName: "Maha", lastName: "Example",
      username: "market_user", phoneNumber: "+905551112233", phoneVerified: true,
    });
    expect(assetIdentityProblem({ ...person, id: "" })).toMatch(/رقمي/);
    expect(assetIdentityProblem({ ...person, username: null })).toMatch(/Username/);
    expect(assetIdentityProblem({ ...person, phoneVerified: false })).toMatch(/توثيق رقم هاتفك/);
    expect(assetIdentityProblem({ ...person, phoneNumber: "123" })).toMatch(/توثيق رقم هاتفك/);
  });

  it("normalizes international phone numbers without inventing a country prefix", () => {
    expect(normalizeAssetPhone("+90 (555) 111-2233")).toBe("+905551112233");
    expect(normalizeAssetPhone("905551112233")).toBe("+905551112233");
    expect(normalizeAssetPhone("555")).toBeNull();
  });

  it("normalizes public and private Telegram asset identifiers", () => {
    expect(normalizeAssetIdentifier("CHANNEL", "@my_channel")).toBe("my_channel");
    expect(normalizeAssetIdentifier("GROUP", "t.me/my_group")).toBe("my_group");
    expect(normalizeAssetIdentifier("GROUP", "-1001234567890")).toBe("-1001234567890");
    expect(normalizeAssetIdentifier("CHANNEL", "not a channel")).toBeNull();
    expect(normalizeAssetIdentifier("BOT", "https://t.me/my_helper_bot")).toBe("my_helper_bot");
  });
});

describe("Telegram asset sale accounting", () => {
  it("splits platform commission without rounding the seller twice", () => {
    expect(splitAssetSale(100)).toEqual({ price: 100, commission: 15, payout: 85 });
    expect(splitAssetSale(19.99)).toEqual({ price: 19.99, commission: 3, payout: 16.99 });
    expect(ASSET_MARKET_MIN_PRICE).toBe(10);
    expect(ASSET_MARKET_MAX_PRICE).toBe(25000);
  });

  it("creates asset sale reference codes accepted by the payment ledger", () => {
    const code = makeAssetSaleCode(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]));
    expect(code).toMatch(/^CHM-[A-Z0-9]{8}$/);
  });
});
