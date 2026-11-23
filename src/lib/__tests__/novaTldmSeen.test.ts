import { noteNovaTldm, novaTldmServed, resetNovaTldmSeen } from "@/lib/novaTldmSeen";
import { tldmEnabled } from "@/lib/coderModels";

describe("Nova T-LDM is switched on by the Studio's own status", () => {
  beforeEach(() => { resetNovaTldmSeen(); delete process.env.NOVA_TLDM; });
  it("is off until a Studio says ready, off again when it says loading or goes silent", () => {
    expect(novaTldmServed(1000)).toBe(false);
    noteNovaTldm("https://a", "ready", 1000);
    expect(novaTldmServed(1000 + 60_000)).toBe(true);
    expect(novaTldmServed(1000 + 11 * 60_000)).toBe(false);
    noteNovaTldm("https://a", "ready", Date.now());
    noteNovaTldm("https://a", "loading");
    expect(novaTldmServed()).toBe(false);
  });
  it("turns Nova's own T-LDM on, never another model's", () => {
    expect(tldmEnabled({}, "coder")).toBe(false);
    noteNovaTldm("https://a", "ready");
    expect(tldmEnabled({}, "coder")).toBe(true);
    expect(tldmEnabled({ perModel: { coder: { tldm: false } } }, "coder")).toBe(false);   // the account's own /tldm off still wins
    expect(tldmEnabled({}, "sham")).toBe(false);
  });
});
