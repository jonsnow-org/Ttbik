// Hosting operations: one-time nonces, the settings export, the caller checks, and the guarantee that no secret can leave through the env export.
const q = jest.fn(); const x = jest.fn();
jest.mock("@/lib/prisma", () => ({ prisma: { $queryRawUnsafe: (...a: unknown[]) => q(...a), $executeRawUnsafe: (...a: unknown[]) => x(...a), bot: { findFirst: jest.fn(async () => null) } } }));
import fs from "fs";
import path from "path";
import { callerIp, consumeNonce, createNonce, exportEnv, sameSecret, HOSTING } from "../hostingOps";
import { ENV_NAMES } from "../hostingEnvNames";

beforeEach(() => { q.mockReset(); x.mockReset(); x.mockResolvedValue(1); });

describe("nonces", () => {
  it("creates 128-bit hex nonces that expire", async () => {
    const n = await createNonce("mode:vercel", 90);
    expect(n).toMatch(/^[0-9a-f]{32}$/);
    const insert = x.mock.calls.find((c) => String(c[0]).includes("INSERT INTO hosting_nonce"));
    expect(insert?.[2]).toBe("mode:vercel"); expect(insert?.[3]).toBe(90);
  });
  it("consumes atomically and refuses malformed or unknown nonces without touching the database", async () => {
    expect(await consumeNonce("../x")).toBeNull(); expect(await consumeNonce("")).toBeNull();
    expect(q).not.toHaveBeenCalled();
    q.mockResolvedValueOnce([{ action: "mode:auto" }]);
    expect(await consumeNonce("a".repeat(32))).toBe("mode:auto");
    expect(String(q.mock.calls[0][0])).toMatch(/DELETE FROM hosting_nonce .* RETURNING action/s);
    q.mockResolvedValueOnce([]);
    expect(await consumeNonce("b".repeat(32))).toBeNull();
  });
});

describe("settings export", () => {
  it("exports only the names the site reads, only those with a value", () => {
    const out = exportEnv({ DATABASE_URL: "postgres://x", CRON_SECRET: "s", VERCEL_OIDC_TOKEN: "platform", AWS_SECRET_ACCESS_KEY: "nope", EMPTY: "", NEXT_PUBLIC_OWNER_ID: "1" });
    expect(out).toEqual({ DATABASE_URL: "postgres://x", CRON_SECRET: "s", NEXT_PUBLIC_OWNER_ID: "1" });
  });
  it("never lists platform or unrelated secrets in the allow-list", () => {
    for (const bad of ["VERCEL_OIDC_TOKEN", "VERCEL_URL", "AWS_SECRET_ACCESS_KEY", "GITHUB_TOKEN", "PATH", "HOME", "PORT"]) expect(ENV_NAMES).not.toContain(bad);
    expect(ENV_NAMES).toContain("DATABASE_URL");
  });
  it("the TypeScript list and the text list used by the shell checker are the same", () => {
    const txt = fs.readFileSync(path.join(__dirname, "../../../deploy/hosting/env-names.txt"), "utf8").split("\n").filter((l) => l.trim() && !l.startsWith("#")).map((l) => l.trim());
    expect([...ENV_NAMES].sort()).toEqual(txt.sort());
  });
});

describe("caller checks", () => {
  it("compares secrets in constant time and never accepts an empty one", () => {
    expect(sameSecret("abc", "abc")).toBe(true);
    expect(sameSecret("abc", "abd")).toBe(false);
    expect(sameSecret("", "")).toBe(false);
    expect(sameSecret("abc", "abcd")).toBe(false);
  });
  it("reads the first address of x-forwarded-for", () => {
    const h = (m: Record<string, string>) => ({ get: (n: string) => m[n] ?? null });
    expect(callerIp(h({ "x-forwarded-for": "1.2.3.4, 9.9.9.9" }))).toBe("1.2.3.4");
    expect(callerIp(h({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
    expect(callerIp(h({}))).toBe("");
  });
  it("the committed hosting file points at the Oracle address the sync route expects", () => {
    expect(HOSTING.oracleIp).toBe("89.168.89.15");
    expect(HOSTING.oracleUrl).toContain("89-168-89-15");
    expect(HOSTING.engineUrl).toBe(HOSTING.gateUrl);   // after the cutover the site speaks as the gate
  });
});
