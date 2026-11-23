// Nova's tool layer must not make the 2-core Studio read more than it has to: a whole-repository tree is pruned to the
// paths an agent can actually work on, a code search carries the matching fragment so no file read follows it, and a
// line window past the end of a file is answered plainly instead of with an empty body.
import { githubClient, pruneTree, runTool } from "@/lib/coderAgent";
import type { CoderToolCall } from "@/lib/openCoderStudio";

const call = (name: string, args: Record<string, unknown>): CoderToolCall => ({ id: "c1", type: "function", function: { name, arguments: JSON.stringify(args) } });
const ctx = (gh: any) => ({ gh, addNote: () => undefined } as any);
const json = (status: number, data: unknown) => ({ status, data });
const b64 = (text: string) => Buffer.from(text, "utf-8").toString("base64");

describe("Nova tool speed", () => {
  it("prunes dependency, build, cache and binary paths from a whole-repository tree", () => {
    const { kept, hidden } = pruneTree([
      "src/app.ts",
      "node_modules/left-pad/index.js",
      "dist/bundle.js",
      ".next/server/page.js",
      "coverage/lcov.info",
      "public/logo.png",
      "assets/icon.svg",
      "docs/guide.md",
      "package.json",
    ]);
    expect(kept).toEqual(["src/app.ts", "assets/icon.svg", "docs/guide.md", "package.json"]);
    expect(hidden).toBe(5);
  });

  it("lists a whole repository without the noise and says how much was left out", async () => {
    const gh = async (_m: string, p: string) => {
      if (p === "/repos/o/r") return json(200, { default_branch: "main" });
      if (p.includes("/git/trees/")) return json(200, { tree: [
        { type: "blob", path: "src/app.ts" },
        { type: "blob", path: "docs/guide.md" },
        { type: "blob", path: "node_modules/x/index.js" },
        { type: "blob", path: "public/logo.png" },
      ] });
      return json(404, {});
    };
    const out = await runTool(call("github_list_files", { repo: "o/r" }), ctx(gh));
    expect(out.split("\n")[0]).toContain("4 files");
    expect(out.split("\n")[0]).toContain("2 dependency/build/binary paths not shown");
    expect(out).toContain("src/app.ts");
    expect(out).toContain("docs/guide.md");
    expect(out).not.toContain("node_modules/");
    expect(out).not.toContain("logo.png");
  });

  it("returns the matching code itself from a code search, so no file read is needed", async () => {
    let seen: Record<string, string> = {};
    const fetchImpl = (async (_url: string, init: { headers: Record<string, string> }) => {
      seen = init.headers;
      return new Response(JSON.stringify({ items: [
        { path: "src/a.ts", text_matches: [{ fragment: "export function go() {\n  return 1;\n}" }] },
        { path: "src/b.ts" },
      ] }), { status: 200 });
    }) as any;
    const out = await runTool(call("github_search_code", { repo: "o/r", query: "go" }), ctx(githubClient("tok", fetchImpl)));
    expect(String(seen.Accept)).toContain("text-match");
    expect(out).toContain("2 file(s) match \"go\"");
    expect(out).toContain("src/a.ts");
    expect(out).toContain("export function go()");
    expect(out).toContain("src/b.ts");
  });

  it("names the reason a code search failed instead of 'no results'", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ message: "API rate limit exceeded" }), { status: 403 })) as any;
    const out = await runTool(call("github_search_code", { repo: "o/r", query: "x" }), ctx(githubClient("tok", fetchImpl)));
    expect(out).toContain("error 403");
    expect(out).toContain("API rate limit exceeded");
    expect(out).toContain("10 requests a minute");
  });

  it("says plainly when a line window starts past the end of the file", async () => {
    const gh = async () => json(200, { content: b64("one\ntwo\nthree"), sha: "abcdef1234" });
    const out = await runTool(call("github_read_file", { repo: "o/r", path: "a.ts", start_line: 40 }), ctx(gh));
    expect(out).toContain("3 lines");
    expect(out).toContain("past its end");
  });
});
