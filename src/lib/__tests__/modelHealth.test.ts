import { classifyStudios } from "@/lib/modelHealth";

describe("model health dot", () => {
  it("green when a ready Studio is free", () => {
    expect(classifyStudios([{ phase: "ready", queue: 0, active: [] }, { phase: "ready", queue: 3, active: [{}] }])).toBe("ok");
  });
  it("yellow when every ready Studio is occupied", () => {
    expect(classifyStudios([{ phase: "ready", queue: 1, active: [{}] }, { phase: "ready", queue: 0, active: [{}] }])).toBe("busy");
  });
  it("red when none is ready or none answers", () => {
    expect(classifyStudios([null, { phase: "loading" }])).toBe("down");
    expect(classifyStudios([])).toBe("down");
  });
});
