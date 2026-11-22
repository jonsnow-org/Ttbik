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

  it("is owner-only until the stored or env switch opens it", () => {
    delete process.env.SHAM_TLDM_OPEN;
    _setTldmPolicyForTests("sham_v2", false, []);
    expect(tldmOpenToAll("sham_v2")).toBe(false);
    expect(tldmAllowedFor("user", "sham_v2")).toBe(false);
    expect(tldmAllowedFor("owner", "sham_v2")).toBe(true);
    _setTldmPolicyForTests("sham_v2", true, []);
    expect(tldmOpenToAll("sham_v2")).toBe(true);
    expect(tldmAllowedFor("user", "sham_v2")).toBe(true);
    delete process.env.SHAM_TLDM_OPEN;
    _setTldmPolicyForTests("sham_v2", false, []);
    process.env.SHAM_TLDM_OPEN = "1";
    expect(tldmAllowedFor("user", "sham_v2")).toBe(true);
  });

  it("matches the owner deny-list as a hard refuse", () => {
    _setTldmPolicyForTests("sham_v2", true, ["rm -rf", "re:drop\\s+table"]);
    expect(tldmDeniedByOwner("rm -rf /tmp/x", tldmOwnerDenyList("sham_v2"))).toMatch(/deny-list/);
    expect(tldmDeniedByOwner("DROP TABLE users", tldmOwnerDenyList("sham_v2"))).toMatch(/deny-list/);
    expect(tldmDeniedByOwner("ls -la", tldmOwnerDenyList("sham_v2"))).toBe("");
    expect(tldmOwnerDenyList("sham_v2")).toEqual(["rm -rf", "re:drop\\s+table"]);
  });

  // Independence: the whole point of the per-model split.
  it("one model's switch never opens another model", () => {
    _setTldmPolicyForTests("coder", true, []);
    expect(tldmAllowedFor("user", "coder")).toBe(true);
    expect(tldmAllowedFor("user", "nova2")).toBe(true);                // nova2 is only a legacy alias of Nova's ONE policy key
    expect(tldmAllowedFor("user", "sham_v2")).toBe(false);
    _setTldmPolicyForTests("coder", false, []);
  });

  it("one model's deny-list never applies to another model", () => {
    _setTldmPolicyForTests("coder", true, ["rm -rf"]);
    expect(tldmOwnerDenyList("coder")).toEqual(["rm -rf"]);
    expect(tldmOwnerDenyList("nova2")).toEqual(["rm -rf"]);            // the same list under the legacy id
    expect(tldmOwnerDenyList("sham_v2")).toEqual([]);                  // Sham Pro never inherits Nova's list
    _setTldmPolicyForTests("coder", false, []);
  });

  it("an env switch is read per model, not shared", () => {
    for (const k of ["SHAM_TLDM_OPEN", "NOVA_TLDM_OPEN", "NOVA1_TLDM_OPEN", "NOVA2_TLDM_OPEN"] as const) delete process.env[k];
    _setTldmPolicyForTests("sham_v2", false, []);
    _setTldmPolicyForTests("coder", false, []);
    process.env.NOVA_TLDM_OPEN = "1";
    expect(tldmOpenToAll("coder")).toBe(true);
    expect(tldmOpenToAll("nova2")).toBe(true);
    expect(tldmOpenToAll("sham_v2")).toBe(false);
    delete process.env.NOVA_TLDM_OPEN;
    process.env.NOVA2_TLDM_OPEN = "1";                                 // the old env names keep working: a deploy never silently closes what the owner opened
    expect(tldmOpenToAll("coder")).toBe(true);
    expect(tldmOpenToAll("sham_v2")).toBe(false);
    delete process.env.NOVA2_TLDM_OPEN;
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
