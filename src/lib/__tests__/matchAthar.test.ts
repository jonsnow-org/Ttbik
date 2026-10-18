jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/match/appStore", () => ({ ensureMatchAppTables: async () => undefined }));
jest.mock("@/lib/atharBotLogic", () => ({ ATHAR_URL: "https://athar.example" }));

import { atharClientConfig, atharDateLink, atharDay, atharEnabled, parseYmd } from "@/lib/match/athar";

describe("Athar promotion (flag MATCH_ENABLE_ATHAR)", () => {
  const env = process.env.MATCH_ENABLE_ATHAR;
  afterEach(() => { process.env.MATCH_ENABLE_ATHAR = env; });
  it("is ON by default (owner 2026-10-14) and OFF with MATCH_ENABLE_ATHAR=0", async () => {
    delete process.env.MATCH_ENABLE_ATHAR;
    expect(atharEnabled()).toBe(true);
    process.env.MATCH_ENABLE_ATHAR = "0";
    expect(atharEnabled()).toBe(false);
    expect(await atharClientConfig()).toBeNull();
    delete process.env.MATCH_ENABLE_ATHAR;
  });
  it("uses Athar's own /date?i=<index> link (index from athar/lib/rules, 1950-01-01 = 0)", () => {
    expect(atharDateLink({ y: 1950, m: 1, d: 1 })).toBe("https://athar.example/date?i=0&lang=ar");
    expect(atharDateLink({ y: 2049, m: 12, d: 31 })).toBe("https://athar.example/date?i=36524&lang=ar");
    expect(atharDateLink({ y: 1949, m: 12, d: 31 })).toBeNull();
    expect(atharDateLink({ y: 2050, m: 1, d: 1 })).toBeNull();
  });
  it("rejects impossible dates", () => {
    expect(parseYmd("2001-02-29")).toBeNull();
    expect(parseYmd("2000-02-29")).toEqual({ y: 2000, m: 2, d: 29 });
    expect(parseYmd("x")).toBeNull();
  });
  it("hides when Athar is unreachable", async () => {
    process.env.MATCH_ENABLE_ATHAR = "1";
    const f = jest.spyOn(global, "fetch" as any).mockRejectedValue(new Error("down") as never);
    expect(await atharClientConfig()).toBeNull();
    f.mockRestore();
  });
});

describe("atharDay: the live look at one day (showcase card)", () => {
  const ok = (j: unknown) => ({ ok: true, json: async () => j }) as any;
  it("shows the richest free kind and marks taken ones", async () => {
    const f = jest.spyOn(global, "fetch" as any).mockResolvedValue(ok({ onChain: true, taken: [true, false, true], auction: [false, false, false], reserved: [false, false, false] }) as never);
    const d = await atharDay({ y: 2026, m: 10, d: 18 }, Date.now() + 1e9);   // a time no earlier call cached
    expect(d?.label).toBe("18 أكتوبر 2026");
    expect(d?.kinds.map((k) => k.free)).toEqual([false, true, false]);
    expect(d?.anyFree).toBe(true);
    expect(d?.img).toBe(`/api/athar/img/${1 * 65536 + d!.index}`);   // silver is the richest free kind
    expect(d?.link).toMatch(/\/date\?i=\d+&lang=ar$/);
    f.mockRestore();
  });
  it("treats an auction as not free, says nothing when Athar does not answer, refuses years outside 1950-2049", async () => {
    let f = jest.spyOn(global, "fetch" as any).mockResolvedValue(ok({ onChain: true, taken: [false, false, false], auction: [false, false, true] }) as never);
    expect((await atharDay({ y: 2001, m: 1, d: 1 }, Date.now() + 2e9))?.kinds[2].free).toBe(false);
    f.mockRestore();
    f = jest.spyOn(global, "fetch" as any).mockRejectedValue(new Error("down") as never);
    const u = await atharDay({ y: 2002, m: 2, d: 2 }, Date.now() + 3e9);
    expect(u?.known).toBe(false); expect(u?.anyFree).toBeNull(); expect(u?.kinds.every((k) => k.free === null)).toBe(true);
    f.mockRestore();
    expect(await atharDay({ y: 1949, m: 12, d: 31 })).toBeNull();
  });
});
