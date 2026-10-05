import { setup, configureKinds, ID } from "./helpers";
import { ruleTier, TOTAL_DATES, TIER } from "../lib/rules";

// The date-pattern rules (palindromes, 11/11, 29 Feb, ...) are the same on the chain and in the app: they now decide a price premium
// (rare pattern x1.5, mythic pattern x2) on the direct kinds, so a divergence would mean a wrong price.
describe("date-pattern rules", () => {
  it("the contract's premium agrees with the reference on the dates (FULL=1 checks all 36,525)", async () => {
    const ctx = await setup(); await configureKinds(ctx);
    const { minter } = ctx;
    const base = await minter.getPrice(0n);
    const counts = [0, 0, 0];
    const step = process.env.FULL ? 1 : 13;
    for (let i = 0; i < TOTAL_DATES; i += step) {
      const ref = ruleTier(i);
      const want = ref === TIER.MYTHIC ? base * 2n : ref === TIER.RARE ? base * 3n / 2n : base;
      const got = await minter.getPriceOf(ID(0, i));
      if (got !== want) throw new Error(`mismatch at ${i}: chain=${got} ref=${want} (rule ${ref})`);
      counts[ref]++;
    }
    console.log("pattern counts over the sampled dates [plain, rare, mythic]:", counts);
    expect(counts[0] + counts[1] + counts[2]).toBeGreaterThan(2000);
  });
});
