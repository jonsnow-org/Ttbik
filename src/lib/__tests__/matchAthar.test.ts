jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/match/appStore", () => ({ ensureMatchAppTables: async () => undefined }));
jest.mock("@/lib/atharBotLogic", () => ({ ATHAR_URL: "https://athar.example" }));

import { atharClientConfig, atharDateLink, atharEnabled, parseYmd } from "@/lib/match/athar";

describe("Athar promotion (flag MATCH_ENABLE_ATHAR)", () => {
  const env = process.env.MATCH_ENABLE_ATHAR;
  afterEach(() => { process.env.MATCH_ENABLE_ATHAR = env; });
  it("is OFF by default", async () => {
    delete process.env.MATCH_ENABLE_ATHAR;
    expect(atharEnabled()).toBe(false);
    expect(await atharClientConfig()).toBeNull();
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
