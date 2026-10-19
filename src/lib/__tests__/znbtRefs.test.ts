jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/hostingOps", () => ({ HOSTING: { gateUrl: "https://x.test" } }));
jest.mock("@/lib/znbtIndex", () => ({ ensureIndexTables: async () => undefined, readSnapshot: async () => null }));
import { Address } from "@ton/core";
import { GAS_ALLOWANCE_NANO, extractBuys, rewardFor } from "@/lib/znbtRefs";

const addr = (n: number) => new Address(0, Buffer.alloc(32, n));
const me = addr(1), curve = addr(2), other = addr(3);
const raw = (a: Address) => a.toRawString();
const transfer = (s: Address, r: Address, amount: bigint) => ({ type: "TonTransfer", status: "ok", TonTransfer: { sender: { address: raw(s) }, recipient: { address: raw(r) }, amount: amount.toString() } });

describe("invite reward maths", () => {
  it("credits 20% of the 1.5% fee, after a gas allowance", () => {
    const { fee, reward } = rewardFor(10_150_000_000n);               // 10.15 sent = 10 net
    expect(fee).toBe(150_000_000n);                                   // 1.5% of 10
    expect(reward).toBe(30_000_000n);                                 // 20% of that
    expect(rewardFor(GAS_ALLOWANCE_NANO).reward).toBe(0n);            // nothing for dust
  });
});

describe("extractBuys", () => {
  const curves = new Set([raw(curve)]);
  it("counts a plain buy and a SmartContractExec buy", () => {
    const evs = [
      { event_id: "e1", timestamp: 100, actions: [transfer(me, curve, 2_000_000_000n)] },
      { event_id: "e2", timestamp: 200, actions: [{ type: "SmartContractExec", status: "ok", SmartContractExec: { executor: { address: raw(me) }, contract: { address: raw(curve) }, ton_attached: "3000000000" } }] },
    ];
    const b = extractBuys(evs, me.toString(), curves);
    expect(b.map((x) => x.grossNano)).toEqual([2_000_000_000n, 3_000_000_000n]);
  });
  it("ignores other contracts, failed or pending events, and bounced buys", () => {
    const evs = [
      { event_id: "a", timestamp: 1, actions: [transfer(me, other, 5_000_000_000n)] },
      { event_id: "b", timestamp: 2, in_progress: true, actions: [transfer(me, curve, 5_000_000_000n)] },
      { event_id: "c", timestamp: 3, actions: [{ ...transfer(me, curve, 5_000_000_000n), status: "failed" }] },
      { event_id: "d", timestamp: 4, actions: [transfer(me, curve, 5_000_000_000n), transfer(curve, me, 4_900_000_000n)] },   // came back
    ];
    expect(extractBuys(evs, me.toString(), curves)).toEqual([]);
  });
  it("still counts a buy when only the small gas excess comes back", () => {
    const evs = [{ event_id: "f", timestamp: 9, actions: [transfer(me, curve, 5_000_000_000n), transfer(curve, me, 50_000_000n)] }];
    expect(extractBuys(evs, me.toString(), curves)).toHaveLength(1);
  });
});
