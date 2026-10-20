import { afterCall, afterText, beforeCall, newStallState, recoveryKnobs, recoveryMessage, STALL_NO_PROGRESS } from "@/lib/coderStall";

const call = (name: string, args: object) => ({ id: "c", type: "function" as const, function: { name, arguments: JSON.stringify(args) } });

describe("stall detection", () => {
  it("same action+args 3 times = repeat_call; the 4th identical call is not run again", () => {
    const ss = newStallState();
    const c = call("github_read_file", { repo: "o/r", path: "a.ts" });
    expect(afterCall(ss, c, "file a", 1).stall).toBeNull();
    expect(afterCall(ss, call("github_read_file", { path: "a.ts", repo: "o/r" }), "file a", 2).stall).toBeNull();   // key order does not matter
    expect(afterCall(ss, c, "file a", 3).stall?.pattern).toBe("repeat_call");
    expect(ss.level).toBe(1);
    const skip = beforeCall(ss, c);
    expect(skip?.skip).toContain("Not run again");
    expect(skip?.skip).toContain("file a");
    expect(beforeCall(ss, call("github_read_file", { repo: "o/r", path: "b.ts" }))).toBeNull();
  });
  it("the same error from different calls = repeat_error", () => {
    const ss = newStallState();
    afterCall(ss, call("github_write_files", { repo: "o/r", branch: "f", files: [{ path: "1" }] }), "error: update branch: 422 x", 1);
    afterCall(ss, call("github_write_files", { repo: "o/r", branch: "f", files: [{ path: "2" }] }), "error: update branch: 422 x", 2);
    expect(afterCall(ss, call("github_write_files", { repo: "o/r", branch: "f", files: [{ path: "3" }] }), "error: update branch: 422 x", 3).stall?.pattern).toBe("repeat_error");
  });
  it("CI polling with nothing new is waiting, not looping", () => {
    const ss = newStallState();
    const c = call("github_ci_status", { repo: "o/r", ref: "f" });
    for (let i = 1; i <= 5; i++) {
      const r = afterCall(ss, c, "combined: pending\nbuild: in_progress", i);
      expect(r.stall?.pattern).not.toBe("repeat_call");
      if (i > 1) expect(r.wait).toBe(true);
    }
    expect(beforeCall(ss, c)).toBeNull();
  });
  it("no new action or result for N steps = no_progress", () => {
    const ss = newStallState();
    let found = null;
    for (let i = 1; i <= STALL_NO_PROGRESS + 1 && !found; i++) found = afterCall(ss, call("web_fetch", { url: `https://x/${i}` }), `error: timeout ${i}`, i).stall;
    expect(found?.pattern).toBe("no_progress");
  });
  it("the same reasoning text again and again = repeat_text", () => {
    const ss = newStallState();
    const t = "I will now read the file again to check the configuration value.";
    expect(afterText(ss, t, 1)).toBeNull();
    expect(afterText(ss, t, 2)).toBeNull();
    expect(afterText(ss, t, 3)?.pattern).toBe("repeat_text");
  });
  it("recovery escalates: reflection, then re-check + think harder, then re-plan from scratch", () => {
    const ss = newStallState();
    ss.level = 1;
    const m1 = recoveryMessage({ pattern: "repeat_call", detail: "x" }, ss, "");
    expect(m1).toContain("NEW numbered plan");
    expect(recoveryKnobs(ss).think).toBe(false);
    ss.level = 3;
    const m3 = recoveryMessage({ pattern: "no_progress", detail: "y" }, ss, "FILE");
    expect(m3).toContain("from scratch");
    expect(m3).toContain("FILE");
    expect(recoveryKnobs(ss)).toEqual({ think: true, temperature: 0.9 });
  });
});
