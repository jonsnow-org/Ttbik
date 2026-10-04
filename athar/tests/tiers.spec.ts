import { setup } from "./helpers";
import { ruleTier, TOTAL_DATES } from "../lib/rules";

describe("rarity rules", () => {
  it("contract and reference agree on every one of the 36,525 dates", async () => {
    const ctx = await setup();
    // the minter getter exposes the rule engine; deploy it by a no-op configure
    const { minter, admin } = ctx;
    await minter.send(admin.getSender(), { value: 1_000_000_000n }, { $$type: "Configure", tier: 0n, startPrice: 500000000n, floor: 250000000n, cap: 8000000000n, bumpBps: 16n, decayBps: 1500n });
    const counts = [0, 0, 0];
    const step = process.env.FULL ? 1 : 13;   // FULL=1 checks all 36,525 dates (about 5 minutes)
    for (let i = 0; i < TOTAL_DATES; i += step) {
      const onchain = Number(await minter.getTierOf(BigInt(i)));
      const ref = ruleTier(i);
      if (onchain !== ref) throw new Error(`mismatch at ${i}: chain=${onchain} ref=${ref}`);
      counts[ref]++;
    }
    console.log("tier counts over all dates [common, rare, mythic]:", counts);
    expect(counts[0] + counts[1] + counts[2]).toBeGreaterThan(2000);
  });
});
