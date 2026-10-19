jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/hostingOps", () => ({ HOSTING: { gateUrl: "https://x.test" } }));
jest.mock("@/lib/znbtIndex", () => ({ ensureIndexTables: async () => undefined, readSnapshot: async () => null }));
import { mnemonicNew, mnemonicToPrivateKey } from "@ton/crypto";
import { WalletContractV4 } from "@ton/ton";
import { GLOBAL_DAILY_CAP_NANO, INVITER_DAILY_CAP_NANO, WALLET_RESERVE_NANO, decryptWords, encryptWords, payoutAmount } from "@/lib/znbtPayout";

const G = 1_000_000_000n;
describe("payoutAmount", () => {
  it("pays what is owed when everything allows it", () => expect(payoutAmount(2n * G, 0n, 0n, 10n * G)).toBe(2n * G));
  it("never goes below the minimum", () => expect(payoutAmount(200_000_000n, 0n, 0n, 10n * G)).toBe(0n));
  it("is limited by the wallet balance minus the reserve", () => expect(payoutAmount(5n * G, 0n, 0n, 2n * G)).toBe(2n * G - WALLET_RESERVE_NANO));
  it("is limited by the per-inviter and global daily caps", () => {
    expect(payoutAmount(30n * G, INVITER_DAILY_CAP_NANO - 3n * G, 0n, 100n * G)).toBe(3n * G);
    expect(payoutAmount(30n * G, 0n, GLOBAL_DAILY_CAP_NANO - 4n * G, 100n * G)).toBe(4n * G);
    expect(payoutAmount(30n * G, INVITER_DAILY_CAP_NANO, 0n, 100n * G)).toBe(0n);
  });
  it("pays nothing when the wallet is empty", () => expect(payoutAmount(5n * G, 0n, 0n, 0n)).toBe(0n));
});

describe("wallet words", () => {
  it("encryption round-trips with the right secret and fails with another", () => {
    const blob = encryptWords("alpha beta gamma", "secret-1");
    expect(blob).not.toContain("alpha");
    expect(decryptWords(blob, "secret-1")).toBe("alpha beta gamma");
    expect(() => decryptWords(blob, "secret-2")).toThrow();
  });
  it("a generated mnemonic encrypted and decrypted gives the same wallet address", async () => {
    const words = await mnemonicNew(24);
    const addrOf = async (w: string[]) => WalletContractV4.create({ publicKey: (await mnemonicToPrivateKey(w)).publicKey, workchain: 0 }).address.toString();
    const back = decryptWords(encryptWords(words.join(" "), "bot-token"), "bot-token").split(" ");
    expect(await addrOf(back)).toBe(await addrOf(words));
  });
});
