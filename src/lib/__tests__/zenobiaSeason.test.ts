// Zenobia seasons: ISO week ids, daily-snapshot inputs per person, closing, and the holders fetch (fake and, when asked, live).
import { Address } from "@ton/core";
import { seasonId, seasonDays, previousSeason, buildPeople, closeSeason, rawAddress, type Snapshots } from "../zenobiaSeason";
import { fetchHolders } from "../zenobiaChain";

const A = new Address(0, Buffer.alloc(32, 1)), B = new Address(0, Buffer.alloc(32, 2)), C = new Address(0, Buffer.alloc(32, 3));
const E9 = 1_000_000_000n;

describe("season ids", () => {
  it("matches ISO weeks, Monday to Sunday", () => {
    expect(seasonId(new Date("2026-10-12T00:05:00Z"))).toBe("2026-W42"); // a Monday
    expect(seasonId(new Date("2026-10-18T23:59:00Z"))).toBe("2026-W42"); // that Sunday
    expect(seasonId(new Date("2026-10-19T00:00:00Z"))).toBe("2026-W43");
    expect(seasonId(new Date("2026-01-01T12:00:00Z"))).toBe("2026-W01");
    expect(seasonId(new Date("2027-01-01T12:00:00Z"))).toBe("2026-W53");
    expect(previousSeason(new Date("2026-10-12T00:20:00Z"))).toBe("2026-W41");
  });
  it("lists the seven days of a season", () => {
    expect(seasonDays("2026-W42")).toEqual(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"]);
    expect(() => seasonDays("nonsense")).toThrow();
  });
});

describe("people from daily snapshots", () => {
  const days = seasonDays("2026-W42");
  // rows[i] is the state from day i on; an empty row or a missing one keeps the previous state
  const snap = (rows: Record<string, bigint>[]): Snapshots => {
    let cur: Record<string, bigint> = {};
    return new Map(days.map((d, i) => { if (rows[i] && Object.keys(rows[i]).length) cur = rows[i]; return [d, new Map(Object.entries(cur))]; }));
  };
  it("averages, sums the person's wallets, and measures moves and sales", () => {
    const a = rawAddress(A.toString()), b = rawAddress(B.toString());
    // person 1 holds 100 the whole week on two wallets (60+40); person 2 sells from 100 to 20 on day 4
    const snaps = snap([{ [a]: 60n * E9, [b]: 40n * E9, [rawAddress(C.toString())]: 100n * E9 }, {}, {}, { [a]: 60n * E9, [b]: 40n * E9, [rawAddress(C.toString())]: 20n * E9 }]);
    const people = buildPeople(snaps, days, new Map([["1", [A.toString(), B.toString()]], ["2", [C.toString()]]]));
    const p1 = people.find((p) => p.id === "1")!, p2 = people.find((p) => p.id === "2")!;
    expect(p1.avgBal).toBeCloseTo(100, 6); expect(p1.volume).toBe(0); expect(p1.sold).toBe(0); expect(p1.accum).toBe(0);
    expect(p2.startBal).toBe(100); expect(p2.sold).toBeCloseTo(80, 6); expect(p2.accum).toBeCloseTo(-80, 6); expect(p2.volume).toBeCloseTo(80, 6);
  });
  it("a person with no verified wallet is simply not scored, and a missing day carries the last balance", () => {
    const a = rawAddress(A.toString());
    const snaps: Snapshots = new Map([[days[0], new Map([[a, 10n * E9]])], [days[6], new Map([[a, 10n * E9]])]]);
    const people = buildPeople(snaps, days, new Map([["1", [A.toString()]]]));
    expect(people).toHaveLength(1);
    expect(people[0].avgBal).toBeCloseTo(10, 6);
  });
  it("closing is deterministic: the same inputs give the same hash and ranking", () => {
    const a = rawAddress(A.toString()), c = rawAddress(C.toString());
    const snaps = snap([{ [a]: 50n * E9, [c]: 500n * E9 }]);
    const persons = new Map([["1", [A.toString()]], ["2", [C.toString()]]]);
    const r1 = closeSeason("2026-W42", buildPeople(snaps, days, persons));
    const r2 = closeSeason("2026-W42", buildPeople(snaps, days, new Map([...persons].reverse())));
    expect(r1.hash).toBe(r2.hash);
    expect(r1.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r1.results[0].id).toBe("2"); // the larger holder ranks first, but with sqrt it is far from 10x
    expect(r1.results[0].score / r1.results[1].score).toBeLessThan(4);
  });
});

describe("fetchHolders", () => {
  const row = (owner: Address, bal: string) => ({ address: "0:" + "ab".repeat(32), owner: { address: owner.toRawString() }, balance: bal });
  it("pages through, and sums several jetton wallets of one owner", async () => {
    const pages = [{ addresses: [row(A, "5"), row(B, "7")], total: 3 }, { addresses: [row(A, "10")], total: 3 }];
    const urls: string[] = [];
    const fetchFn = (async (u: string) => { urls.push(u); const i = urls.length - 1; return { ok: true, json: async () => pages[i] }; }) as any;
    const m = await fetchHolders("EQjetton", { fetchFn, pageSize: 2 });
    expect(m.get(rawAddress(A.toString()))).toBe(15n);
    expect(m.get(rawAddress(B.toString()))).toBe(7n);
    expect(urls[1]).toContain("offset=2");
  });
  it("fails loudly when the API errors", async () => {
    await expect(fetchHolders("EQx", { fetchFn: (async () => ({ ok: false, status: 429 })) as any })).rejects.toThrow(/429/);
  });
  (process.env.ZNB_LIVE ? it : it.skip)("LIVE read-only: reads a real jetton's holders from tonapi", async () => {
    const m = await fetchHolders("EQAvlWFDxGF2lXm67y4yzC17wYKD9A0guwPkMs1gOsM__NOT", { pageSize: 50, maxPages: 1 });
    console.log("live holders read:", m.size, "largest raw balance:", [...m.values()].reduce((a, b) => (a > b ? a : b), 0n).toString());
    expect(m.size).toBeGreaterThan(10);
  });
});
