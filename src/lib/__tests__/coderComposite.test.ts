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

describe("tools Nova was missing", () => {
  const mk = (routes: Record<string, any>, writes: any[] = []) => ({
    gh: async (m: string, path: string, body?: any) => {
      if (m !== "GET") writes.push({ m, path, body });
      const k = Object.keys(routes).find((r) => path.startsWith(r));
      return k ? routes[k] : { status: 404, data: { message: "nf" } };
    }, addNote: () => undefined,
  }) as any;
  const call = (name: string, args: object, ctx: any) => runTool({ id: "x", type: "function", function: { name, arguments: JSON.stringify(args) } }, ctx);

  it("github_ci_logs: finds the failed run of a branch and shows the tail of each failed job's log", async () => {
    const ctx = mk({
      "/repos/o/r/actions/runs?": { status: 200, data: { workflow_runs: [{ id: 7, conclusion: "success" }, { id: 9, conclusion: "failure" }] } },
      "/repos/o/r/actions/runs/9/jobs": { status: 200, data: { jobs: [{ id: 5, name: "build", conclusion: "failure", steps: [{ name: "Run tests", conclusion: "failure" }] }, { id: 6, name: "lint", conclusion: "success" }] } },
      "/repos/o/r/actions/jobs/5/logs": { status: 200, data: "2026-10-25T10:00:00.0000000Z ok\n2026-10-25T10:00:01.0000000Z Error: expected 1 got 2" },
    }, []);
    const out = await call("github_ci_logs", { repo: "o/r", ref: "main" }, ctx);
    expect(out).toMatch(/run 9/); expect(out).toMatch(/job "build" — failed step: Run tests/); expect(out).toMatch(/Error: expected 1 got 2/); expect(out).not.toMatch(/lint/);
  });
  it("github_pr_info and github_compare summarise in one call", async () => {
    const ctx = mk({
      "/repos/o/r/pulls/3/files": { status: 200, data: [{ status: "modified", filename: "a.ts", additions: 2, deletions: 1 }] },
      "/repos/o/r/pulls/3/comments": { status: 200, data: [{ user: { login: "rev" }, path: "a.ts", line: 4, body: "rename this" }] },
      "/repos/o/r/pulls/3": { status: 200, data: { title: "T", state: "open", head: { ref: "f" }, base: { ref: "main" }, mergeable: true, mergeable_state: "clean", additions: 2, deletions: 1, changed_files: 1, body: "desc" } },
      "/repos/o/r/issues/3/comments": { status: 200, data: [{ user: { login: "me" }, body: "thanks" }] },
      "/repos/o/r/compare/": { status: 200, data: { status: "ahead", ahead_by: 1, behind_by: 0, total_commits: 1, commits: [{ sha: "abcdef123", commit: { message: "fix" } }], files: [{ status: "added", filename: "n.ts", additions: 5, deletions: 0 }] } },
    });
    const pr = await call("github_pr_info", { repo: "o/r", number: 3 }, ctx);
    expect(pr).toMatch(/#3 T — open, f → main, mergeable: true/); expect(pr).toMatch(/M a\.ts \(\+2\/-1\)/); expect(pr).toMatch(/\[review rev on a\.ts:4\] rename this/); expect(pr).toMatch(/\[me\] thanks/);
    expect(await call("github_compare", { repo: "o/r", base: "main", head: "f" }, ctx)).toMatch(/ahead: 1 ahead[\s\S]*A n\.ts \(\+5\/-0\)/);
  });
  it("github_edit_file replaces one exact piece of text and commits; zero or several matches are refused", async () => {
    const writes: any[] = [];
    const file = (t: string) => ({ status: 200, data: { content: Buffer.from(t).toString("base64"), sha: "S1" } });
    let ctx = mk({ "/repos/o/r/contents/a.ts": file("const a = 1;\nconst b = 2;\n") }, writes);
    await call("github_edit_file", { repo: "o/r", branch: "f", path: "a.ts", old: "const b = 2;", new: "const b = 3;", message: "m" }, { ...ctx, gh: async (m: string, p: string, b?: any) => (m === "PUT" ? (writes.push({ p, b }), { status: 200, data: { commit: { sha: "abcdef1234" } } }) : ctx.gh(m, p, b)) });
    expect(Buffer.from(writes[0].b.content, "base64").toString()).toBe("const a = 1;\nconst b = 3;\n"); expect(writes[0].b.sha).toBe("S1"); expect(writes[0].b.branch).toBe("f");
    expect(await call("github_edit_file", { repo: "o/r", branch: "f", path: "a.ts", old: "const", new: "let" }, ctx)).toMatch(/occurs 2 times/);
    expect(await call("github_edit_file", { repo: "o/r", branch: "f", path: "a.ts", old: "zzz", new: "y" }, ctx)).toMatch(/occurs 0 times/);
  });
});

describe("general tools", () => {
  const call = (name: string, args: object, ctx: any = { gh: null, addNote: () => undefined }) => runTool({ id: "x", type: "function", function: { name, arguments: JSON.stringify(args) } }, ctx);
  it("http_request reaches a public API (answer read), refuses private / local addresses, and a write does not follow redirects", async () => {
    const seen: any[] = [];
    const fetchImpl = (async (url: string, init: any) => {
      seen.push({ url, method: init.method, body: init.body, headers: init.headers });
      if (url.endsWith("/redir")) return new Response("", { status: 302, headers: { location: "https://93.184.216.35/new" } });
      return new Response('{"ok":true}', { status: 200, headers: { "content-type": "application/json" } });
    }) as any;
    const ctx = { gh: null, addNote: () => undefined, fetchImpl };
    expect(await call("http_request", { url: "https://93.184.216.34/api" }, ctx)).toMatch(/HTTP 200 application\/json\n\{"ok":true\}/);
    expect(seen[0].method).toBe("GET");
    expect(await call("http_request", { method: "POST", url: "https://93.184.216.34/api", headers: { Authorization: "Bearer t" }, body: '{"a":1}' }, ctx)).toMatch(/HTTP 200/);
    expect(seen[1].method).toBe("POST"); expect(seen[1].body).toBe('{"a":1}'); expect(seen[1].headers.Authorization).toBe("Bearer t");
    expect(await call("http_request", { method: "POST", url: "https://93.184.216.34/redir" }, ctx)).toMatch(/HTTP 302 → https:\/\/93\.184\.216\.35\/new/);
    for (const u of ["http://127.0.0.1/x", "http://localhost/x", "http://10.0.0.5/x", "http://169.254.169.254/latest/meta-data", "ftp://93.184.216.34/x"]) expect(await call("http_request", { url: u }, ctx)).toMatch(/^error:/);
    expect(await call("http_request", { method: "TRACE", url: "https://93.184.216.34/" }, ctx)).toMatch(/^error: method must be/);
  });
  it("http_request writes need the user's confirmation (a read does not); send_file is refused for a sub-agent", async () => {
    const { classifyCall } = await import("@/lib/coderAgent");
    const c = (a: object) => classifyCall({ id: "1", type: "function", function: { name: "http_request", arguments: JSON.stringify(a) } }, null);
    expect((await c({ url: "https://x.test/a" })).risks).toEqual([]);
    expect((await c({ method: "DELETE", url: "https://x.test/a" })).risks).toEqual(["external_write"]);
    expect(await call("send_file", { path: "a.txt" })).toMatch(/main chat only/);
  });
});

describe("what the agents may use", () => {
  const { agentToolAllowed, HELPER_IDS, AGENT_TOOL_NAMES } = require("@/lib/coderAgents");
  it("readers and testers get the new read tools; HTTP only for reading; a worker has everything", () => {
    for (const n of ["github_ci_logs", "github_pr_info", "github_commits", "github_compare", "deep_research", "web_fetch", "http_request"]) expect(agentToolAllowed(n, "reader")).toBe(true);
    for (const n of ["github_edit_file", "github_write_files", "send_file", "sandbox_edit_file"]) expect(agentToolAllowed(n, "reader")).toBe(false);
    expect(agentToolAllowed("sandbox_search", "tester")).toBe(true); expect(agentToolAllowed("sandbox_search", "reader")).toBe(false);
    expect(agentToolAllowed("http_request", "reader", 1, { method: "GET" })).toBe(true);
    expect(agentToolAllowed("http_request", "reader", 1, { method: "POST" })).toBe(false);
    expect(agentToolAllowed("http_request", "tester", 1, { method: "DELETE" })).toBe(false);
    expect(agentToolAllowed("http_request", "worker", 1, { method: "POST" })).toBe(true);
    expect(agentToolAllowed("github_edit_file", "worker")).toBe(true);
    expect(AGENT_TOOL_NAMES.has("github_edit_file")).toBe(false);
  });
  it("there are preset helper jobs for the new tools", () => {
    expect(HELPER_IDS).toEqual(expect.arrayContaining(["ci_doctor", "pr_reviewer", "change_digest", "api_reader"]));
  });
});
