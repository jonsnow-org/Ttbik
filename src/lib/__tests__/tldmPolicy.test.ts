import { parseDenyList, tldmAllowedFor, tldmDeniedByOwner, tldmOpenToAll, tldmOwnerDenyList, _setTldmPolicyForTests } from "@/lib/tldmPolicy";

describe("T-LDM audience and owner deny-list (per model)", () => {
  const prev = process.env.SHAM_TLDM_OPEN;
  const prevN1 = process.env.NOVA1_TLDM_OPEN;
  const prevN2 = process.env.NOVA2_TLDM_OPEN;
  afterEach(() => {
    _setTldmPolicyForTests("sham_v2", false, []);
    _setTldmPolicyForTests("coder", false, []);
    _setTldmPolicyForTests("nova2", false, []);
    for (const [k, v] of [["SHAM_TLDM_OPEN", prev], ["NOVA1_TLDM_OPEN", prevN1], ["NOVA2_TLDM_OPEN", prevN2]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("parses a deny list and ignores comments and blanks", () => {
    expect(parseDenyList("rm -rf\n# note\n\nre:drop\\s+table\n")).toEqual(["rm -rf", "re:drop\\s+table"]);
    expect(parseDenyList([" git push ", "", "#x"])).toEqual(["git push"]);
  });

  it("is open to every user on every T-LDM model, with no switch", () => {
    for (const m of ["sham_v2", "coder", "nova2"]) {
      expect(tldmOpenToAll(m)).toBe(true);
      expect(tldmAllowedFor("user", m)).toBe(true);
      expect(tldmAllowedFor("owner", m)).toBe(true);
    }
  });

  it("matches the owner deny-list as a hard refuse", () => {
    _setTldmPolicyForTests("sham_v2", true, ["rm -rf", "re:drop\\s+table"]);
    expect(tldmDeniedByOwner("rm -rf /tmp/x", tldmOwnerDenyList("sham_v2"))).toMatch(/deny-list/);
    expect(tldmDeniedByOwner("DROP TABLE users", tldmOwnerDenyList("sham_v2"))).toMatch(/deny-list/);
    expect(tldmDeniedByOwner("ls -la", tldmOwnerDenyList("sham_v2"))).toBe("");
    expect(tldmOwnerDenyList("sham_v2")).toEqual(["rm -rf", "re:drop\\s+table"]);
  });

  it("one model's deny-list never applies to another model", () => {
    _setTldmPolicyForTests("coder", true, ["rm -rf"]);
    expect(tldmOwnerDenyList("coder")).toEqual(["rm -rf"]);
    expect(tldmOwnerDenyList("nova2")).toEqual(["rm -rf"]);            // the same list under the legacy id
    expect(tldmOwnerDenyList("sham_v2")).toEqual([]);                  // Sham Pro never inherits Nova's list
    _setTldmPolicyForTests("coder", false, []);
  });

  it("an unknown model inherits nothing (no silent cross-model enable)", () => {
    _setTldmPolicyForTests("sham_v2", true, ["rm -rf"]);
    expect(tldmOpenToAll("sham")).toBe(false);
    expect(tldmAllowedFor("user", "sham")).toBe(false);
    expect(tldmOwnerDenyList("sham")).toEqual([]);
    expect(tldmOpenToAll(undefined)).toBe(false);
    _setTldmPolicyForTests("sham_v2", false, []);
  });
});
