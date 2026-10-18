jest.mock("@/lib/prisma", () => ({ prisma: { $executeRawUnsafe: jest.fn(), $queryRawUnsafe: jest.fn(async () => []) } }));
import { evaluate, type Facts } from "../znbtGuard";

const ok: Facts = { icon: { status: 200, type: "image/webp", servedBy: "oracle" }, gate: true, oracle: true, vercel: true, chain: { master: "unknown", curve: "none" } };
describe("guard decisions", () => {
  it("is quiet when everything is fine", () => { expect(evaluate(ok)).toEqual([]); });
  it("flags a failing icon, a safety-copy icon, a dead gate and both servers down as problems", () => {
    expect(evaluate({ ...ok, icon: { status: 500, type: "", servedBy: "" } }).map((f) => f.key)).toContain("icon");
    expect(evaluate({ ...ok, icon: { status: 200, type: "image/webp", servedBy: "builtin" } }).map((f) => f.key)).toContain("icon-fallback");
    expect(evaluate({ ...ok, gate: false }).find((f) => f.key === "gate")?.level).toBe("problem");
    expect(evaluate({ ...ok, oracle: false, vercel: false }).find((f) => f.key === "servers")?.level).toBe("problem");
  });
  it("one server down is information only", () => {
    expect(evaluate({ ...ok, oracle: false })).toEqual([expect.objectContaining({ key: "oracle", level: "info" })]);
    expect(evaluate({ ...ok, vercel: false })).toEqual([expect.objectContaining({ key: "vercel", level: "info" })]);
  });
  it("after launch, an inactive coin or master contract is a problem; unknown (toncenter busy) is not", () => {
    expect(evaluate({ ...ok, chain: { master: "active", curve: "other" } }).map((f) => f.key)).toEqual(["curve"]);
    expect(evaluate({ ...ok, chain: { master: "other", curve: "active" } }).map((f) => f.key)).toEqual(["master"]);
    expect(evaluate({ ...ok, chain: { master: "unknown", curve: "unknown" } })).toEqual([]);
  });
});
