// ZNBt configuration: the override can only change curve/open/launchedAt, and the owner's own launch is recognised on the chain index.
jest.mock("@/lib/prisma", () => ({ prisma: { $executeRawUnsafe: jest.fn(async () => 1), $queryRawUnsafe: jest.fn(async () => []) } }));
import { Address } from "@ton/core";
import { BASE, findZnbt, mergeConfig, OWNER_WALLET, ZNBT_SALT } from "../znbtConfig";

const curve = Address.parse("EQAagBm1wghWIl9mtEYclWgS6vtYuy9NiekxAXM1ArjsDCh-").toString({ bounceable: true, urlSafe: true });

describe("merge", () => {
  it("keeps the base and never lets the override change the master", () => {
    const m = mergeConfig(BASE, { master: "EQ_evil" } as never);
    expect(m.master).toBe(BASE.master); expect(m.open).toBe(false); expect(m.curve).toBe("");
  });
  it("applies a valid curve, open flag and launch time, ignores junk", () => {
    expect(mergeConfig(BASE, { curve, open: true, launchedAt: "2026-10-18T18:00:00Z" })).toMatchObject({ curve, open: true, launchedAt: "2026-10-18T18:00:00Z" });
    const bad = mergeConfig(BASE, { curve: "nope", open: "yes" as never, launchedAt: "soon" });
    expect(bad).toEqual(BASE);
  });
});
describe("finding ZNBt", () => {
  const mine = { curve: "EQAagBm1wghWIl9mtEYclWgS6vtYuy9NiekxAXM1ArjsDCh-", creator: OWNER_WALLET, salt: ZNBT_SALT, createdAt: 1_792_000_000 };
  it("recognises the owner's launch by wallet and salt only", () => {
    const z = findZnbt([{ ...mine, salt: "5" }, { ...mine, creator: "UQAagBm1wghWIl9mtEYclWgS6vtYuy9NiekxAXM1ArjsDCh-8Zr" }, mine]);
    expect(z?.curve).toBe(curve); expect(z?.launchedAt).toBe(new Date(1_792_000_000 * 1000).toISOString());
  });
  it("finds nothing when someone else used the same salt or there are no coins", () => {
    expect(findZnbt([])).toBeNull();
    expect(findZnbt([{ ...mine, creator: "UQDZdzKb1m3aWK2nm5T1nGtsVmmPMeVR8P3OnOr7szTRAPsB" }])).toBeNull();
  });
});
