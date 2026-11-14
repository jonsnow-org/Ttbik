import { putSecret, resolveSecrets, resolveSecretsDeep, scrubSecrets, listSecretNames, deleteSecret, hasSecret, hasSecretRefs, __testing } from "@/lib/secretVault";

describe("secret box", () => {
  beforeEach(() => __testing.reset());

  test("stores a value, lists only names, resolves references and scrubs values back", () => {
    putSecret(7, "github_pw", "p@ss-W0rd!", { label: "GitHub" });
    expect(listSecretNames(7)).toEqual([expect.objectContaining({ name: "github_pw", label: "GitHub" })]);
    expect(JSON.stringify(listSecretNames(7))).not.toContain("p@ss");
    expect(resolveSecrets(7, "login --password {{secret:github_pw}}")).toBe("login --password p@ss-W0rd!");
    expect(scrubSecrets(7, "echo p@ss-W0rd! done")).toBe("echo {{secret:github_pw}} done");
    expect(resolveSecretsDeep(7, { a: ["x {{ secret:github_pw }}"], n: 3 })).toEqual({ a: ["x p@ss-W0rd!"], n: 3 });
  });

  test("another chat never sees it; unknown or deleted names throw without echoing a value", () => {
    putSecret(1, "tok", "abcdef123");
    expect(() => resolveSecrets(2, "{{secret:tok}}")).toThrow(/not in the secret box/);
    expect(hasSecret(1, "tok")).toBe(true);
    deleteSecret(1, "tok");
    expect(() => resolveSecrets(1, "{{secret:tok}}")).toThrow(/tok/);
  });

  test("expires, validates the name and the size", () => {
    jest.useFakeTimers();
    putSecret(1, "short", "value123", { ttlMs: 60_000 });
    jest.setSystemTime(Date.now() + 61_000);
    expect(hasSecret(1, "short")).toBe(false);
    jest.useRealTimers();
    expect(() => putSecret(1, "9bad", "x")).toThrow();
    expect(() => putSecret(1, "ok_name", "")).toThrow();
    expect(() => putSecret(1, "ok_name", "x".repeat(4001))).toThrow();
  });

  test("text without references is untouched", () => {
    expect(resolveSecrets(1, "plain")).toBe("plain");
    expect(hasSecretRefs("a {{secret:abc}} b")).toBe(true);
    expect(hasSecretRefs("nothing")).toBe(false);
  });
});

describe("secret requests (Sham)", () => {
  const { requestSecret, openSecretRequests, closeSecretRequest } = require("@/lib/secretVault");
  beforeEach(() => __testing.reset());
  test("a request is listed for its chat only and closes", () => {
    requestSecret(5, "gh_token", "to open a PR");
    expect(openSecretRequests(5)).toEqual([expect.objectContaining({ name: "gh_token", purpose: "to open a PR" })]);
    expect(openSecretRequests(6)).toEqual([]);
    expect(closeSecretRequest(5, "gh_token")).toBe(true);
    expect(openSecretRequests(5)).toEqual([]);
    expect(() => requestSecret(5, "1bad", "x")).toThrow();
  });
});
