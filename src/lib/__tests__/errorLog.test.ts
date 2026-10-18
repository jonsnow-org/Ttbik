jest.mock("../prisma", () => ({ prisma: { $executeRawUnsafe: jest.fn().mockResolvedValue(1), $queryRawUnsafe: jest.fn().mockResolvedValue([]) } }));
import { fingerprint } from "../errorLog";

describe("error fingerprint", () => {
  test("the same bug with different ids and numbers groups together", () => {
    const a = fingerprint("bot:MARRIAGE_BOT", "Invalid `prisma.matchProfile.count()` invocation: max clients reached, pool_size: 15 (1d4a7ac2-6bc4-4955-8c26-b9d5bbc05593)");
    const b = fingerprint("bot:MARRIAGE_BOT", "Invalid `prisma.matchProfile.count()` invocation: max clients reached, pool_size: 20 (aaaaaaaa-6bc4-4955-8c26-b9d5bbc05593)");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });
  test("a different source or message is a different error", () => {
    expect(fingerprint("route:/a", "boom")).not.toBe(fingerprint("route:/b", "boom"));
    expect(fingerprint("route:/a", "boom")).not.toBe(fingerprint("route:/a", "crash"));
  });
});
