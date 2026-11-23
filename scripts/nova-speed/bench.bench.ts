// Nova tool-payload benchmark (measurement, not CI).
//
// It calls the REAL tool functions the bot runs (src/lib/coderAgent.ts `runTool`) against a fixed in-memory repository —
// big source files, node_modules/.next/dist trees, media and binaries — twice in one run: with the earlier behaviour
// (CODER_TREE_PRUNE=off, CODER_SEARCH_FRAGMENTS=off) and with the current one. It prints, per operation, the payload
// in characters, the estimated prompt tokens and the model calls a task needs. Nothing here talks to GitHub or a Studio.
//
// Why this matters: Nova's Studio reads its prompt at ~9 tokens/s on 2 cores, so a tool result of 9,000 characters
// (~2,600 tokens) is ~5 minutes of reading before the next word. The benchmark turns that into a repeatable number.
import { RESULT_MAX, runTool } from "@/lib/coderAgent";

// The runner supplies these (jest); declared here so `tsc --noEmit -p .` stays clean without pulling @types/jest into the app.
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => Promise<void>) => void;
declare const expect: (actual: unknown) => {
  toBe: (v: unknown) => void;
  toBeLessThan: (v: number) => void;
  toBeLessThanOrEqual: (v: number) => void;
  toBeGreaterThan: (v: number) => void;
};

const CHARS_PER_TOKEN = Math.max(1, Number(process.env.NOVA_BENCH_TOK) || 3.5);   // conservative for code/JSON
const READ_TOK_S = 9;                                                             // Nova's 35B Studio, measured on the CPU box

type FixtureFile = { path: string; text: string };

/** Deterministic filler: same bytes on every machine, no random, no clock. */
function fillerLine(i: number): string {
  return `export const entry${i} = { id: ${i}, label: "row ${i}", value: ${i * 7}, tags: ["alpha", "beta"] };`;
}
/** A big source file: `lines` filler lines with `resolveTask` defined in the middle. */
function bigSource(path: string, lines: number): FixtureFile {
  const body: string[] = [`// ${path} — generated fixture file, ${lines} lines`];
  for (let i = 0; i < lines; i++) {
    if (i === Math.floor(lines / 2)) {
      body.push("export function resolveTask(input: string): string {");
      body.push("  const cleaned = input.trim();");
      body.push("  return cleaned.length ? cleaned : \"no task\";");
      body.push("}");
    }
    body.push(fillerLine(i));
  }
  return { path, text: body.join("\n") + "\n" };
}

/** The fixed fixture repository: 7 real files + a dependency/build/media tree like a real project. */
function fixture(): FixtureFile[] {
  const files: FixtureFile[] = [
    { path: "README.md", text: ["# fixture", "", "A repository used by the Nova tool benchmark.", "", ...Array.from({ length: 40 }, (_, i) => `- note ${i}`)].join("\n") },
    { path: "package.json", text: JSON.stringify({ name: "fixture", version: "1.0.0", scripts: { test: "node --test" }, dependencies: { left: "^1.0.0" } }, null, 2) },
    { path: "src/app.ts", text: ["import { resolveTask } from \"./big/service\";", "", "export function main(input: string) {", "  return resolveTask(input);", "}", ...Array.from({ length: 30 }, (_, i) => fillerLine(i))].join("\n") },
    bigSource("src/big/service.ts", 1200),
    bigSource("src/big/worker.ts", 1100),
    bigSource("src/legacy/engine.ts", 900),
    { path: "src/util.ts", text: Array.from({ length: 40 }, (_, i) => fillerLine(i)).join("\n") },
    { path: "src/deep/nested/module.ts", text: Array.from({ length: 60 }, (_, i) => fillerLine(i)).join("\n") },
    { path: "tests/app.test.ts", text: ["import { main } from \"../src/app\";", "test(\"main\", () => { main(\"x\"); });"].join("\n") },
  ];
  // dependency / build / cache trees: hundreds of paths the agent never edits
  for (let i = 0; i < 260; i++) files.push({ path: `node_modules/pkg-${i}/dist/index.js`, text: `module.exports = ${i};\n` });
  for (let i = 0; i < 140; i++) files.push({ path: `.next/static/chunks/${i}.js`, text: `!function(){/* chunk ${i} */}();\n` });
  for (let i = 0; i < 30; i++) files.push({ path: `dist/bundle-${i}.js`, text: `/* bundle ${i} */\n` });
  for (const path of ["public/logo.png", "public/hero.jpg", "assets/intro.mp4", "assets/font.woff2", "docs/scan.pdf"]) {
    files.push({ path, text: `BINARY ${path} ${"x".repeat(200)}` });
  }
  return files;
}

const TEXT_EXT = /\.(?:ts|tsx|js|jsx|md|json)$/i;
const needle = "resolveTask";

/** 4 lines around the first hit — what GitHub's text-match fragment is. */
function fragmentAround(text: string): string {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => l.includes(needle));
  return lines.slice(Math.max(0, at - 1), at + 4).join("\n");
}

/** A stand-in for the GitHub REST API, serving the fixture: same routes the tools call, same response shapes. */
function fakeGitHub(files: FixtureFile[]) {
  const byPath = new Map(files.map((f) => [f.path, f.text]));
  return async (_method: string, path: string, _body?: unknown, headers?: Record<string, string>) => {
    if (path === "/repos/o/fixture") return { status: 200, data: { default_branch: "main", full_name: "o/fixture", private: false, description: "benchmark fixture" } };
    if (path.startsWith("/repos/o/fixture/git/trees/")) return { status: 200, data: { tree: files.map((f) => ({ type: "blob", path: f.path })), truncated: false } };
    if (path.startsWith("/repos/o/fixture/contents/")) {
      const p = decodeURIComponent(path.slice("/repos/o/fixture/contents/".length).split("?")[0]);
      const text = byPath.get(p);
      if (text === undefined) return { status: 404, data: { message: "Not Found" } };
      return { status: 200, data: { content: Buffer.from(text, "utf-8").toString("base64"), sha: "abc1234" + p.length } };
    }
    if (path.startsWith("/search/code")) {
      const hits = files.filter((f) => TEXT_EXT.test(f.path) && f.text.includes(needle) && !f.path.startsWith("node_modules/"));
      const withFragments = String(headers?.Accept || "").includes("text-match");
      return { status: 200, data: { items: hits.map((f) => ({ path: f.path, ...(withFragments ? { text_matches: [{ fragment: fragmentAround(f.text) }] } : {}) })) } };
    }
    return { status: 404, data: { message: `unexpected ${path}` } };
  };
}

let seq = 0;
const call = (name: string, args: Record<string, unknown>) => ({ id: `c${++seq}`, type: "function" as const, function: { name, arguments: JSON.stringify(args) } });
type Ctx = Parameters<typeof runTool>[1];

/** Runs one or more tool calls and returns the exact payload the model would read (what runTool returns). */
async function payload(ctx: Ctx, calls: { name: string; args: Record<string, unknown> }[]): Promise<{ out: string[]; chars: number; calls: number }> {
  const out: string[] = [];
  for (const c of calls) out.push(await runTool(call(c.name, c.args), ctx));
  return { out, chars: out.reduce((n, s) => n + s.length, 0), calls: calls.length };
}

const hits = () => fixture().filter((f) => TEXT_EXT.test(f.path) && f.text.includes(needle) && !f.path.startsWith("node_modules/")).map((f) => f.path);

type Op = { name: string; args: Record<string, unknown> };
/**
 * Both plans for one user request ("where is resolveTask defined, and is it what I think?").
 * old: search returns bare paths, so every matched file must be read to see the code.
 * new: the search itself carries the code, so the same answer is complete in one step.
 * Each side is measured with its OWN plan and with the behaviour switch of its own path — that is the honest comparison.
 */
function operations(): Record<string, { old: Op[]; now: Op[] }> {
  const search: Op = { name: "github_search_code", args: { repo: "o/fixture", query: needle } };
  return {
    "github_list_files — whole repository tree": { old: [{ name: "github_list_files", args: { repo: "o/fixture" } }], now: [{ name: "github_list_files", args: { repo: "o/fixture" } }] },
    "github_repo_scan — first look at a repository": { old: [{ name: "github_repo_scan", args: { repo: "o/fixture" } }], now: [{ name: "github_repo_scan", args: { repo: "o/fixture" } }] },
    "github_search_code — \"resolveTask\" (bigger by design: it now carries the code)": { old: [search], now: [search] },
    "TASK locate + confirm a function": {
      old: [search, ...hits().map((path) => ({ name: "github_read_file", args: { repo: "o/fixture", path } }))],
      now: [search],
    },
  };
}

async function measure(): Promise<Record<string, { old: { chars: number; calls: number }; now: { chars: number; calls: number } }>> {
  const files = fixture();
  const ctx = { gh: fakeGitHub(files), addNote: () => undefined } as Ctx;
  const result: Record<string, { old: { chars: number; calls: number }; now: { chars: number; calls: number } }> = {};
  for (const [label, plan] of Object.entries(operations())) {
    process.env.CODER_TREE_PRUNE = "off";
    process.env.CODER_SEARCH_FRAGMENTS = "off";
    const before = await payload(ctx, plan.old);
    delete process.env.CODER_TREE_PRUNE;
    delete process.env.CODER_SEARCH_FRAGMENTS;
    const after = await payload(ctx, plan.now);
    result[label] = { old: { chars: before.chars, calls: before.calls }, now: { chars: after.chars, calls: after.calls } };
  }
  return result;
}

const pct = (from: number, to: number): string => (from <= 0 ? "0%" : `${Math.round(((from - to) / from) * 100)}%`);
const pad = (s: string, n: number): string => (s.length >= n ? s : s + " ".repeat(n - s.length));
const padl = (s: string, n: number): string => (s.length >= n ? s : " ".repeat(n - s.length) + s);
const tokens = (chars: number): number => Math.round(chars / CHARS_PER_TOKEN);
const readMinutes = (chars: number): string => (tokens(chars) / READ_TOK_S / 60).toFixed(1);

describe("Nova tool payload benchmark", () => {
  it("prints the old and new payload of the same fixture, and the new path is never heavier", async () => {
    const files = fixture();
    const noise = files.filter((f) => /^(node_modules|\.next|dist)\//.test(f.path)).length;
    const binaries = files.filter((f) => /\.(?:png|jpg|mp4|woff2|pdf)$/i.test(f.path)).length;
    const sourceFiles = files.length - noise - binaries;
    const rows = await measure();

    const head = `${pad("operation", 46)}${padl("old chars", 11)}${padl("new chars", 11)}${padl("saved", 8)}${padl("old tok~", 10)}${padl("new tok~", 10)}${padl("saved", 8)}${padl("read min", 10)}${padl("calls", 10)}`;
    const lines = [head, "-".repeat(head.length)];
    for (const [label, r] of Object.entries(rows)) {
      lines.push(
        pad(label, 46) + padl(String(r.old.chars), 11) + padl(String(r.now.chars), 11) + padl(pct(r.old.chars, r.now.chars), 8) +
        padl(String(tokens(r.old.chars)), 10) + padl(String(tokens(r.now.chars)), 10) + padl(pct(tokens(r.old.chars), tokens(r.now.chars)), 8) +
        padl(`${readMinutes(r.old.chars)} → ${readMinutes(r.now.chars)}`, 10) + padl(`${r.old.calls} → ${r.now.calls}`, 10),
      );
    }
    // eslint-disable-next-line no-console
    console.log([
      "",
      `Nova tool payloads — fixed fixture: ${files.length} files (${sourceFiles} source/docs, ${noise} dependency/build paths, ${binaries} binaries)`,
      `cap per tool result: ${RESULT_MAX} chars · estimate: ${CHARS_PER_TOKEN} chars/token · Nova's CPU Studio: ${READ_TOK_S} prompt tokens/s`,
      "old = CODER_TREE_PRUNE=off + CODER_SEARCH_FRAGMENTS=off (the earlier behaviour) · new = defaults",
      "",
      ...lines,
      "",
      "read min = estimated minutes the model spends reading that payload before it can act (tokens ÷ 9 ÷ 60).",
      "",
    ].join("\n"));

    const list = rows["github_list_files — whole repository tree"];
    expect(list.now.chars).toBeLessThan(list.old.chars / 4);                  // the dependency/build tree is most of that payload
    const scan = rows["github_repo_scan — first look at a repository"];
    expect(scan.now.chars).toBeLessThanOrEqual(scan.old.chars);
    const task = rows["TASK locate + confirm a function"];
    expect(task.now.calls).toBeLessThan(task.old.calls);                       // the search now carries the code
    expect(task.now.chars).toBeLessThan(task.old.chars / 4);
    const search = Object.entries(rows).find(([label]) => label.startsWith("github_search_code"))![1];
    expect(search.now.chars).toBeGreaterThan(search.old.chars);               // bigger alone; the task row is what matters
  });
});
