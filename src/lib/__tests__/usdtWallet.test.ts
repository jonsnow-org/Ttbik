import { OWNER_USDT_TRC20, usdtAddress, usdtNetwork } from "@/lib/usdtWallet";

describe("usdtWallet", () => {
  const keep = { ...process.env };
  afterEach(() => { process.env = { ...keep }; });
  it("shows the owner's TRC20 wallet even when an old USDT_ADDRESS is left in env", () => {
    process.env.USDT_ADDRESS = "TYoZe1S3cpzCzmuP2qdQLGvVRysm9XJ4Nu";
    expect(usdtAddress()).toBe("TSVES7iRYHCrGbJ9UzJzxypDXQY65KTgsn");
    expect(OWNER_USDT_TRC20).toMatch(/^T[1-9A-HJ-NP-Za-km-z]{33}$/);
  });
  it("always labels it TRC20, never ERC20/BEP20 from env", () => {
    process.env.USDT_NETWORK = "ERC20";
    expect(usdtNetwork()).toBe("TRC20");
  });
});
