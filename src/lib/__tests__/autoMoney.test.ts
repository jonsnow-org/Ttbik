const db: any = { $executeRawUnsafe: jest.fn(async () => 0), $executeRaw: jest.fn(async () => 1), $queryRaw: jest.fn(async () => []) };
jest.mock("@/lib/prisma", () => ({ prisma: db }));
import { chooseGift, MIN_POINTS, pickWinners, prizeFor } from "@/lib/contests/prizes";
import { parseRefCommand } from "@/lib/remit/refLinks";
import { autoApprove, secretOk, validateApplication } from "@/lib/remit/listings";
import { PROVIDERS, providerLink } from "@/lib/remit/remit";

const at = (m: number) => new Date(Date.UTC(2026, 10, 10, 0, m));

describe("automatic contest prizes", () => {
  it("picks the top 3 eligible players, ties to the earlier one", () => {
    const w = pickWinners([
      { user_id: "a", name: "A", points: 50, rounds: 3, first_at: at(5) },
      { user_id: "b", name: "B", points: 50, rounds: 2, first_at: at(1) },
      { user_id: "c", name: "C", points: 90, rounds: 1, first_at: at(0) }, // one round only
      { user_id: "d", name: "D", points: MIN_POINTS - 1, rounds: 4, first_at: at(0) }, // too few points
      { user_id: "e", name: null, points: 30, rounds: 2, first_at: at(9) },
      { user_id: "f", name: "F", points: 25, rounds: 2, first_at: at(9) },
    ]);
    expect(w.map((x) => x.user_id)).toEqual(["b", "a", "e"]);
    expect(w[2].name).toBe("لاعب");
  });
  it("maps ranks to prizes per mode", () => {
    expect(prizeFor("TG", 1)).toBe("PREMIUM3");
    expect(prizeFor("TG", 2)).toBe("GIFT");
    expect(prizeFor("VOUCHER", 1)).toBe("VOUCHER");
  });
  it("chooses the best affordable gift and skips sold-out limited ones", () => {
    const g = chooseGift([{ id: "x", star_count: 15 }, { id: "y", star_count: 50 }, { id: "z", star_count: 100 }, { id: "l", star_count: 45, total_count: 10, remaining_count: 0 }]);
    expect(g).toEqual({ id: "y", star_count: 50 });
    expect(chooseGift([{ id: "z", star_count: 100 }])).toBeNull();
  });
});

describe("remittance listings and referral links", () => {
  it("parses the owner's /ref command", () => {
    expect(parseRefCommand("/ref")).toEqual({ kind: "list" });
    expect(parseRefCommand("/ref changenow https://changenow.io/?link_id=abc")).toEqual({ kind: "set", key: "CHANGENOW", url: "https://changenow.io/?link_id=abc" });
    expect(parseRefCommand("/ref CHANGENOW off")).toEqual({ kind: "clear", key: "CHANGENOW" });
    expect(parseRefCommand("/ref NOPE https://x.y")?.kind).toBe("error");
    expect(parseRefCommand("/ref CHANGENOW javascript:alert(1)")?.kind).toBe("error");
    expect(parseRefCommand("hello")).toBeNull();
    expect(parseRefCommand("/referral")).toBeNull();
  });
  it("prefers the saved link over env and the official site", () => {
    const p = PROVIDERS.find((x) => x.key === "CHANGENOW")!;
    expect(providerLink(p, {}, {})).toEqual({ href: p.url, sponsored: false });
    expect(providerLink(p, { REMIT_REF_CHANGENOW: "https://env.example/r" }, { CHANGENOW: "https://saved.example/r" }).href).toBe("https://saved.example/r");
  });
  it("has unique keys and https official links only", () => {
    expect(new Set(PROVIDERS.map((p) => p.key)).size).toBe(PROVIDERS.length);
    for (const p of PROVIDERS) expect(p.url.startsWith("https://")).toBe(true);
    expect(PROVIDERS.length).toBeGreaterThanOrEqual(20);
  });
  it("validates an application and requires the licence + consent", () => {
    const base = { name: "شام للصرافة", country: "سوريا", license: "مصرف سوريا المركزي", contact: "@cham_exchange", agree: true };
    expect(validateApplication(base).ok).toBe(true);
    expect(validateApplication({ ...base, license: "" }).ok).toBe(false);
    expect(validateApplication({ ...base, agree: false }).ok).toBe(false);
    expect(validateApplication({ ...base, url: "http://x.com" }).ok).toBe(false);
    const v = validateApplication({ ...base, contact: "cham_exchange", plan: "FEATURED" });
    expect(v.ok && v.v.contact).toBe("@cham_exchange");
    expect(v.ok && v.v.plan).toBe("FEATURED");
  });
  it("keeps auto-approve off unless the owner turns it on, and checks the private key", () => {
    expect(autoApprove({})).toBe(false);
    expect(autoApprove({ REMIT_AUTO_APPROVE: "1" })).toBe(true);
    expect(secretOk({ secret: "abc" }, "abc")).toBe(true);
    expect(secretOk({ secret: "abc" }, "abd")).toBe(false);
    expect(secretOk(null, "abc")).toBe(false);
  });
});
