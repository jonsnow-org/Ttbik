import { parseDenyList, tldmAllowedFor, tldmDeniedByOwner, tldmOpenToAll, tldmOwnerDenyList, _setTldmPolicyForTests } from "@/lib/tldmPolicy";

describe("T-LDM audience and owner deny-list", () => {
  const prev = process.env.SHAM_TLDM_OPEN;
  afterEach(() => {
    _setTldmPolicyForTests(false, []);
    if (prev === undefined) delete process.env.SHAM_TLDM_OPEN;
    else process.env.SHAM_TLDM_OPEN = prev;
  });

  it("parses a deny list and ignores comments and blanks", () => {
    expect(parseDenyList("rm -rf\n# note\n\nre:drop\\s+table\n")).toEqual(["rm -rf", "re:drop\\s+table"]);
    expect(parseDenyList([" git push ", "", "#x"])).toEqual(["git push"]);
  });

  it("is owner-only until the stored or env switch opens it", () => {
    delete process.env.SHAM_TLDM_OPEN;
    _setTldmPolicyForTests(false, []);
    expect(tldmOpenToAll()).toBe(false);
    expect(tldmAllowedFor("user")).toBe(false);
    expect(tldmAllowedFor("owner")).toBe(true);
    _setTldmPolicyForTests(true, []);
    expect(tldmOpenToAll()).toBe(true);
    expect(tldmAllowedFor("user")).toBe(true);
    delete process.env.SHAM_TLDM_OPEN;
    _setTldmPolicyForTests(false, []);
    process.env.SHAM_TLDM_OPEN = "1";
    expect(tldmAllowedFor("user")).toBe(true);
  });

  it("matches the owner deny-list as a hard refuse", () => {
    _setTldmPolicyForTests(true, ["rm -rf", "re:drop\\s+table"]);
    expect(tldmDeniedByOwner("rm -rf /tmp/x")).toMatch(/deny-list/);
    expect(tldmDeniedByOwner("DROP TABLE users")).toMatch(/deny-list/);
    expect(tldmDeniedByOwner("ls -la")).toBe("");
    expect(tldmOwnerDenyList()).toEqual(["rm -rf", "re:drop\\s+table"]);
  });
});
