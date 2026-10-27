// Nova and Sham are separate products: own weights, tools, system, runtime. Neither imports the other's modules.
// The one place they meet on the Sham side is shamHost.ts (platform services such as web access and limits); on the Nova side only the Mini App's control plane
// (coderApp.ts: the owner's switches) and the Telegram shell (novaBotLogic.ts, which routes a chat to the model it chose) know both.
import fs from "fs";
import path from "path";

const LIB = path.resolve(__dirname, "..");
const files = fs.readdirSync(LIB).filter((f) => /\.tsx?$/.test(f));
const importsOf = (f: string): string[] => {
  const src = fs.readFileSync(path.join(LIB, f), "utf8");
  const out: string[] = [];
  for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*|require\(\s*)["']([^"']+)["']/g)) out.push(m[1]);
  return out;
};
const isNova = (f: string) => /^(coder[A-Z0-9]\w*|coder|openCoderStudio|novaMedia|novaMediaRoutes)\.tsx?$/.test(f);
const isSham = (f: string) => /^sham[A-Z]\w*\.tsx?$/.test(f) || f === "sham.ts";

describe("Nova <-> Sham boundary", () => {
  it("finds the modules it is meant to police", () => {
    expect(files.filter(isNova).length).toBeGreaterThan(10);
    expect(files.filter(isSham).length).toBeGreaterThan(5);
  });

  it("no Sham module imports Nova's engine or tools (only shamHost.ts, the adapter, does)", () => {
    const bad: string[] = [];
    for (const f of files.filter(isSham).filter((x) => x !== "shamHost.ts"))
      for (const i of importsOf(f)) if (/^@\/lib\/(coder|openCoder|nova)/.test(i) || /^\.\/(coder|openCoder|nova)/.test(i)) bad.push(`${f} -> ${i}`);
    expect(bad).toEqual([]);
  });

  it("no Nova module imports a Sham module (the Mini App control plane is the one allowed exception)", () => {
    const bad: string[] = [];
    for (const f of files.filter(isNova).filter((x) => x !== "coderApp.ts"))
      for (const i of importsOf(f)) if (/^@\/lib\/sham/.test(i) || /^\.\/sham/.test(i)) bad.push(`${f} -> ${i}`);
    expect(bad).toEqual([]);
  });

  it("shamHost.ts is reached only through shamExec's lazy import", () => {
    const users = files.filter((f) => f !== "shamHost.ts" && importsOf(f).includes("@/lib/shamHost"));
    expect(users).toEqual(["shamExec.ts"]);
  });

  it("Nova's engine has no Sham model branch (no sham_loop / sham_probe / shamAsModel / role sham)", () => {
    const text = ["openCoderStudio.ts", "coderAgents.ts", "coderAgent.ts"].map((f) => fs.readFileSync(path.join(LIB, f), "utf8")).join("\n");
    expect(text).not.toMatch(/sham_loop|sham_probe|shamAsModel|role === "sham"/);
  });
});
