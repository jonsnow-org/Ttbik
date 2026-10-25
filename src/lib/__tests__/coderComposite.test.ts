import { runTool } from "@/lib/coderAgent";

const b64 = (t: string) => Buffer.from(t).toString("base64");
const calls: string[] = [];
const gh = async (_m: string, path: string) => {
  calls.push(path);
  if (path.includes("/git/trees/")) return { status: 200, data: { tree: [{ type: "blob", path: "README.md" }, { type: "blob", path: "package.json" }, { type: "blob", path: "src/a.ts" }, { type: "blob", path: "src/b.ts" }] } };
  if (/\/contents\//.test(path)) { const f = decodeURIComponent(path.split("/contents/")[1].split("?")[0]); return { status: 200, data: { content: b64(`content of ${f}`), sha: "abcdef123" } }; }
  if (path === "/repos/o/r") return { status: 200, data: { full_name: "o/r", default_branch: "main" } };
  return { status: 404, data: {} };
};
const ctx = { gh, addNote: () => undefined } as any;
const run = (name: string, args: object) => runTool({ id: "x", type: "function", function: { name, arguments: JSON.stringify(args) } }, ctx);

describe("composite read tools", () => {
  it("github_repo_scan gives facts, folders, README and manifest in one call", async () => {
    const out = await run("github_repo_scan", { repo: "o/r" });
    expect(out).toMatch(/o\/r/);
    expect(out).toMatch(/folders: src/);
    expect(out).toMatch(/=== README.md ===[\s\S]*content of README.md/);
    expect(out).toMatch(/=== package.json ===[\s\S]*content of package.json/);
  });
  it("github_read_files reads several files in one call, at most 4", async () => {
    const out = await run("github_read_files", { repo: "o/r", paths: ["a", "b", "c", "d", "e"] });
    expect(out).toMatch(/=== a ===[\s\S]*content of a/);
    expect(out).toMatch(/=== d ===/);
    expect(out).not.toMatch(/=== e ===/);
    expect(await run("github_read_files", { repo: "o/r", paths: [] })).toMatch(/^error/);
  });
});
