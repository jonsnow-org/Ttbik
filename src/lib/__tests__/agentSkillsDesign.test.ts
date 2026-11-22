import { AGENT_SKILLS, AGENT_SKILL_NAMES, agentSkillText } from "@/lib/agentSkills";

describe("design and logo skills (from the ModelScope skills page review, 2026-11-22)", () => {
  it("are available to every model through the shared skill list", () => {
    expect(AGENT_SKILL_NAMES).toEqual(expect.arrayContaining(["design", "logo"]));
  });
  it("the design skill carries the plan-review-build process, the generic defaults to avoid and the Arabic rule", () => {
    const t = agentSkillText("design");
    expect(t).toMatch(/design plan/i);
    expect(t).toMatch(/AVOID the generic defaults/);
    expect(t).toMatch(/dir=\\?"rtl\\?"/);
    expect(t).toMatch(/phone width/);
    expect(t.length).toBeLessThan(4000);                 // loaded on demand into a CPU model's context: keep it short
  });
  it("the logo skill never lets the image model render long words", () => {
    expect(agentSkillText("logo")).toMatch(/garbles letters/);
  });
  it("every skill still has a title, a trigger and steps", () => {
    for (const [k, v] of Object.entries(AGENT_SKILLS)) { expect(v.title && v.when && v.steps).toBeTruthy(); expect(agentSkillText(k)).toContain(`SKILL ${k}`); }
    expect(agentSkillText("nope")).toMatch(/design/);
  });
});
