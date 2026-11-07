import { activityLine, hudLines, lastOutputLine } from "@/lib/computerHud";

describe("computer in-screen console", () => {
  it("reads the last non-empty output line", () => {
    expect(lastOutputLine("a\n\nb   \nc\n")).toBe("c");
    expect(lastOutputLine("")).toBe("");
    expect(lastOutputLine(undefined)).toBe("");
  });

  it("picks one readable line per event and never dumps raw fields", () => {
    expect(activityLine({ action: "run", detail: "ls -la", output: "total 4\nfile.txt\n" })).toBe("run ls -la → file.txt");
    expect(activityLine({ text: "قراءة ملف" })).toBe("قراءة ملف");
    expect(activityLine({ output: "done" })).toBe("→ done");
    expect(activityLine(null)).toBe("");
    expect(activityLine({} as never)).toBe("");
  });

  it("collapses repeats, appends running jobs and keeps only the newest lines", () => {
    const activity = [{ text: "a" }, { text: "a" }, { text: "b" }, { text: "c" }, { text: "d" }];
    expect(hudLines(activity, [], 3)).toEqual(["b", "c", "d"]);
    expect(hudLines([{ text: "x" }], [{ name: "npm run build" }, { id: "job-1" }], 6)).toEqual(["x", "▶ npm run build", "▶ job-1"]);
    expect(hudLines(null, null, 6)).toEqual([]);
    expect(hudLines([], [], 6)).toEqual([]);
  });

  it("truncates a very long line so the overlay never overflows", () => {
    const line = activityLine({ text: "z".repeat(500) });
    expect(line.length).toBe(220);
  });
});
