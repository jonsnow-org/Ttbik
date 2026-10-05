import fs from "fs";
import os from "os";
import path from "path";

// The owner's Toncenter key: saved from the panel into the data folder, write-only (only the last four characters can be read back),
// a key set on the server wins, a malformed key is refused.
describe("settings: Toncenter key", () => {
  let dir: string, S: typeof import("../web/lib/settings");
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "athar-settings-"));
    process.env.ATHAR_DATA_DIR = dir; delete process.env.TONCENTER_API_KEY;
    jest.resetModules(); S = require("../web/lib/settings");
  });
  afterEach(() => { delete process.env.ATHAR_DATA_DIR; delete process.env.TONCENTER_API_KEY; fs.rmSync(dir, { recursive: true, force: true }); });

  it("has no key at first", () => {
    expect(S.toncenterKey()).toBe("");
    expect(S.keyStatus()).toEqual({ source: "none", hint: "" });
  });
  it("saves a key, uses it at once, and shows only its last four characters", () => {
    const key = "abcDEF0123456789_-xyzQ";
    S.saveToncenterKey(key);
    expect(S.toncenterKey()).toBe(key);
    expect(S.keyStatus()).toEqual({ source: "panel", hint: "xyzQ" });
    expect(JSON.stringify(S.keyStatus())).not.toContain(key);
    const f = path.join(dir, "secrets", "toncenter.key");
    expect(fs.readFileSync(f, "utf8")).toBe(key);
    expect(fs.statSync(f).mode & 0o077).toBe(0);        // readable by the server only
  });
  it("a key set on the server wins over the saved one", () => {
    S.saveToncenterKey("abcDEF0123456789_-xyzQ");
    process.env.TONCENTER_API_KEY = "serverKey0123456789ABCD";
    expect(S.toncenterKey()).toBe("serverKey0123456789ABCD");
    expect(S.keyStatus().source).toBe("server");
  });
  it("refuses a malformed key and removes a saved one", () => {
    for (const bad of ["", "short", "has space in it 1234567890", "x".repeat(200), "<script>alert(1)</script>"]) expect(() => S.saveToncenterKey(bad)).toThrow();
    expect(S.toncenterKey()).toBe("");
    S.saveToncenterKey("abcDEF0123456789_-xyzQ");
    S.clearToncenterKey();
    expect(S.toncenterKey()).toBe("");
    expect(S.keyStatus().source).toBe("none");
  });
});
