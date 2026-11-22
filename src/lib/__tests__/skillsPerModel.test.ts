// Every model has its OWN skill file (owner 2026-11-22: independence between models is a red line). design and logo came from the ModelScope skills page review.
import { NOVA_SKILLS, NOVA_SKILL_NAMES, novaSkillText } from "@/lib/skillsNova";
import { SHAM_SKILLS, SHAM_SKILL_NAMES, shamSkillText } from "@/lib/skillsSham";
import { SHAMPRO_SKILLS, SHAMPRO_SKILL_NAMES, shamproSkillText } from "@/lib/skillsShamPro";
import { shamTools } from "@/lib/shamExec";
import { shamVariant } from "@/lib/shamStudio";
import fs from "fs";
import path from "path";

describe("design and logo skills, one copy per model", () => {
  it("each model has them", () => {
    for (const names of [NOVA_SKILL_NAMES, SHAM_SKILL_NAMES, SHAMPRO_SKILL_NAMES]) expect(names).toEqual(expect.arrayContaining(["design", "logo"]));
  });
  it("the design skill carries the plan-review-build process, the generic defaults to avoid and the Arabic rule", () => {
    for (const t of [novaSkillText("design"), shamSkillText("design"), shamproSkillText("design")]) {
      expect(t).toMatch(/design plan/i);
      expect(t).toMatch(/AVOID the generic defaults/);
      expect(t).toMatch(/dir=\\?"rtl\\?"/);
      expect(t.length).toBeLessThan(4000);
    }
  });
  it("the logo skill never lets the image model render long words", () => {
    expect(novaSkillText("logo")).toMatch(/garbles letters/);
  });
  it("every skill has a title, a trigger and steps, and an unknown one lists the model's own names", () => {
    for (const reg of [NOVA_SKILLS, SHAM_SKILLS, SHAMPRO_SKILLS]) for (const v of Object.values(reg)) expect(v.title && v.when && v.steps).toBeTruthy();
    expect(shamproSkillText("nope")).toMatch(/design/);
  });
  it("independence: no shared skill module exists and the three files do not import each other", () => {
    const dir = path.join(__dirname, "..");
    expect(fs.existsSync(path.join(dir, "agentSkills.ts"))).toBe(false);
    for (const f of ["skillsNova.ts", "skillsSham.ts", "skillsShamPro.ts"]) expect(fs.readFileSync(path.join(dir, f), "utf8")).not.toMatch(/^import /m);
  });
  it("each Sham's skill tool offers its own names", async () => {
    const names = (variant: "v1" | "v2") => shamVariant.run(variant, () => (shamTools(false) as any[]).find((t) => t.function.name === "skill").function.parameters.properties.name.enum);
    expect(names("v1")).toEqual(SHAM_SKILL_NAMES);
    expect(names("v2")).toEqual(SHAMPRO_SKILL_NAMES);
  });
});
