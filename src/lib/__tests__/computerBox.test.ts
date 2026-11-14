import { boxActionFor, boxDo, cleanBoxArgs, renderBoxReply } from "@/lib/computerBox";
import { COMPUTER_PLAYBOOK, toolGroups } from "@/lib/coderAgent";
const unb64 = (x: string): string => (x.startsWith("b64:") ? Buffer.from(x.slice(4), "base64").toString("utf8") : x);   // jobs travel as base64 (the gateway filter rejects some plain text)

describe("the model's own persistent computer", () => {
  test("computer_batch maps every step to its Studio action, refuses unknown or nested steps, and renders each result", () => {
    const b = boxActionFor("computer_batch", { steps: [{ tool: "computer_read", path: "a" }, { tool: "computer_run", command: "ls", continue_on_error: true }] });
    expect(b).toMatchObject({ action: "batch", steps: [{ action: "read", path: "a" }, { action: "run", command: "ls", continue_on_error: true }] });
    expect(cleanBoxArgs(b!)).toMatchObject({ action: "batch", steps: [{ action: "read" }, { action: "run", continue_on_error: true }] });
    expect(boxActionFor("computer_batch", { steps: [{ tool: "computer_batch" }] })).toBeNull();
    expect(boxActionFor("computer_batch", { steps: [{ tool: "rm_rf" }] })).toBeNull();
    expect(boxActionFor("computer_batch", { steps: [] })).toBeNull();
    expect(cleanBoxArgs({ action: "batch", steps: [{ action: "batch" }] })).toBeNull();
    const out = renderBoxReply("batch", { ok: true, seconds: 0.4, results: [{ action: "write", ok: true, path: "x", bytes: 1 }, { action: "run", ok: false, skipped: true, error: "not run: time budget" }] });
    expect(out).toContain("[1] write: wrote x (1 bytes)");
    expect(out).toContain("[2] run: not run");
  });

  test("the four tools map to the Studio's actions and nothing else", () => {
    expect(boxActionFor("computer_run", { command: "ls", timeout: 5 })).toMatchObject({ action: "run", command: "ls", timeout: 5 });
    expect(boxActionFor("computer_write", { path: "a.txt", content: "x" })).toMatchObject({ action: "write", path: "a.txt" });
    expect(boxActionFor("computer_read", {})).toMatchObject({ action: "read", path: "." });
    expect(boxActionFor("computer_job", { action: "start", command: "sleep 1" })).toMatchObject({ action: "job_start" });
    expect(boxActionFor("computer_job", { action: "format" })).toBeNull();
    expect(boxActionFor("computer_repo", { url: "https://github.com/a/b", ref: "main" })).toEqual({ action: "repo", url: "https://github.com/a/b", ref: "main" });
    expect(boxActionFor("computer_search", { pattern: "needle", glob: "*.ts" })).toMatchObject({ action: "search", pattern: "needle", path: ".", glob: "*.ts" });
    expect(boxActionFor("sandbox_exec", {})).toBeNull();
    expect(boxActionFor("computer_patch", { diff: "--- a/x\n+++ b/x\n", cwd: "repos/a-b" })).toEqual({ action: "patch", diff: "--- a/x\n+++ b/x\n", cwd: "repos/a-b" });
    expect(boxActionFor("computer_test", { cwd: "repos/a-b" })).toEqual({ action: "test", cwd: "repos/a-b", command: "" });
    expect(boxActionFor("computer_tools", {})).toEqual({ action: "tools" });
    expect(cleanBoxArgs({ action: "patch", diff: "d".repeat(500_000) })?.diff).toHaveLength(400_000);
    expect(renderBoxReply("patch", { ok: true, files: ["a.ts", "b.ts"], output: "PATCH_OK via git" })).toMatch(/a\.ts, b\.ts/);
    expect(renderBoxReply("test", { ok: true, id: "j1", command: "npm test --silent", cwd: "p" })).toMatch(/TESTS_EXIT/);
    expect(renderBoxReply("patch", { ok: false, error: "the patch does not apply here (nothing was changed)", output: "hunk FAILED" })).toMatch(/does not apply[\s\S]*hunk FAILED/);
  });

  test("fields are bounded before they reach the Studio", () => {
    const clean = cleanBoxArgs({ action: "run", command: "x".repeat(20000), timeout: 9999, cwd: "src" })!;
    expect(String(clean.command).length).toBe(8000);
    expect(clean.timeout).toBe(300);
    expect(cleanBoxArgs({ action: "rm" })).toBeNull();
    expect(cleanBoxArgs({ action: "job_log", id: "abcdefgh", tail: 9999 })).toEqual({ action: "job_log", id: "abcdefgh", tail: 400 });
    expect(cleanBoxArgs({ action: "activity", since: -5, limit: 999 })).toEqual({ action: "activity", since: 0, limit: 40 });
    expect(cleanBoxArgs({ action: "activity", since: 17, limit: 12 })).toEqual({ action: "activity", since: 17, limit: 12 });
  });

  test("the model reads exit code, output and the hint for long work", () => {
    const text = renderBoxReply("run", { ok: true, exit_code: 124, seconds: 90, cwd: ".", output: "partial", timed_out: true, hint: "use computer_job" });
    expect(text).toContain("exit 124 (stopped: too long)");
    expect(text).toContain("partial");
    expect(text).toContain("use computer_job");
    expect(renderBoxReply("read", { ok: true, kind: "folder", path: ".", entries: ["d src", "f a.txt (3 B)"] })).toContain("d src");
    expect(renderBoxReply("job_log", { ok: true, id: "abcd1234", running: false, exit_code: 0, seconds: 3, output: "done" })).toContain("finished with exit 0");
    expect(renderBoxReply("run", { ok: false, error: "disk full" })).toBe("error: disk full");
  });

  test("a search that is still running is shown with its job id and what it found so far", () => {
    const text = renderBoxReply("search", { ok: true, running: true, id: "cd34ef56", matches: "src/a.ts:3:foo", seconds: 15.4, hint: "Read the rest with computer_job action=log id=cd34ef56" });
    expect(text).toContain("still searching in the background as job cd34ef56");
    expect(text).toContain("src/a.ts:3:foo");
    expect(text).toContain("computer_job action=log id=cd34ef56");
  });

  test("a command still running after the foreground wait is shown as a job to poll, not as exit null", () => {
    const text = renderBoxReply("run", { ok: true, running: true, id: "ab12cd34", job: "ab12cd34", exit_code: null, seconds: 15.2, cwd: ".", output: "installing…", hint: "Read the rest with computer_job action=log id=ab12cd34" });
    expect(text).toContain("still running in the background as job ab12cd34");
    expect(text).toContain("installing…");
    expect(text).toContain("computer_job action=log id=ab12cd34");
    expect(text).not.toContain("exit null");
  });

  test("the playbook rides with the first result and a repository answer says what to do next", () => {
    const first = renderBoxReply("run", { ok: true, exit_code: 0, seconds: 0.1, cwd: ".", output: "hi", tips: "YOUR COMPUTER - how to work fast\n1. Start every task..." });
    expect(first).toContain("how to work fast");
    expect(renderBoxReply("run", { ok: true, exit_code: 0, seconds: 0.1, cwd: ".", output: "hi" })).not.toContain("how to work fast");
    const repo = renderBoxReply("repo", { ok: true, path: "repos/a-b", seconds: 4.2, summary: "files: 120  size: 3M\ntop level:\nsrc" });
    expect(repo).toContain("repository ready in ~/repos/a-b");
    expect(repo).toContain("computer_search");
    expect(renderBoxReply("repo", { ok: true, path: "repos/a-b", job: "abc12345", message: "still downloading; read progress with computer_job" })).toContain("still downloading");
    expect(renderBoxReply("search", { ok: true, matches: "src/a.ts:2:const needle = 2;" })).toContain("src/a.ts:2");
  });

  test("a clone that is still downloading is waited for inside the tool (no model polling steps)", async () => {
    process.env.MODELSCOPE_API_TOKEN = "t";
    process.env.BOX_JOB_WAIT_MS = "0";
    const sent: string[] = [];
    let polls = 0;
    const fetchImpl = jest.fn(async (input: any, init?: any) => {
      const url = String(input);
      if (url.endsWith("/gradio_api/call/box_do")) { sent.push(unb64(JSON.parse(String(init.body)).data[0])); return new Response(JSON.stringify({ event_id: "e" + sent.length }), { status: 200 }); }
      const a = JSON.parse(sent[sent.length - 1]);
      const r = a.action === "repo" ? { ok: true, path: "repos/o-r", job: "j9", message: "still downloading" } : { ok: true, id: "j9", running: ++polls < 1, exit_code: 0, seconds: 5, output: "done" };
      return new Response("event: complete\ndata: " + JSON.stringify([JSON.stringify(r)]) + "\n\n", { status: 200 });
    }) as any;
    const out = await boxDo("coder", "1:coder", { action: "repo", url: "https://github.com/o/r" }, fetchImpl);
    expect(out).toContain("repository ready in ~/repos/o-r");
    expect(sent.map((x) => JSON.parse(x).action)).toEqual(["repo", "job_log"]);
    delete process.env.BOX_JOB_WAIT_MS;
  });

  test("a command goes to the model's own Studio with the user+model session", async () => {
    process.env.MODELSCOPE_API_TOKEN = "t";
    const calls: { url: string; body?: any }[] = [];
    const fetchImpl = jest.fn(async (input: any, init?: any) => {
      const url = String(input);
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith("/gradio_api/call/box_do")) return new Response(JSON.stringify({ event_id: "e1" }), { status: 200 });
      return new Response("event: complete\ndata: " + JSON.stringify([JSON.stringify({ ok: true, exit_code: 0, seconds: 0.1, cwd: ".", output: "hello" })]) + "\n\n", { status: 200 });
    }) as any;
    const out = await boxDo("lfm25", "42:lfm25", { action: "run", command: "echo hello" }, fetchImpl);
    expect(out).toContain("hello");
    expect(calls[0].url).toContain("nova-inference-server");
    expect(JSON.parse(unb64(calls[0].body.data[0]))).toEqual({ action: "run", command: "echo hello", session: "42:lfm25" });
    // Sham and Sham v2 have NO computer Studio: their computer is inside the model's own loop (owner 2026-11-08), so the app never sends them a command
    const before = calls.length;
    expect(await boxDo("sham_v2", "1:x", { action: "run", command: "ls" }, fetchImpl)).toMatch(/no computer Studio/);
    expect(await boxDo("sham", "1:x", { action: "run", command: "ls" }, fetchImpl)).toMatch(/no computer Studio/);
    expect(calls.length).toBe(before);
  });

  test("persistent computer and temporary worker are separate tool groups", () => {
    const computer = (toolGroups(false, false).computer || []).map((t) => t.function.name);
    const worker = (toolGroups(false, false).worker || []).map((t) => t.function.name);
    for (const name of ["computer_run", "computer_write", "computer_read", "computer_job", "computer_repo", "computer_search", "browser"]) expect(computer).toContain(name);
    expect(computer).not.toContain("sandbox_exec");
    expect(worker).toEqual(expect.arrayContaining(["sandbox_clone", "sandbox_exec", "sandbox_wait", "sandbox_search"]));
    expect(COMPUTER_PLAYBOOK).toContain("computer_repo");
    expect(COMPUTER_PLAYBOOK).toContain("computer_job");
  });
});

describe("writing fast: edit in place and publish in one commit", () => {
  const { runTool, guardCall } = require("@/lib/coderAgent");
  const call = (name: string, args: object) => ({ id: "x", type: "function", function: { name, arguments: JSON.stringify(args) } });

  test("computer_edit sends only the changed text; several edits go in one call", () => {
    expect(boxActionFor("computer_edit", { path: "a.ts", old: "x", new: "y" })).toMatchObject({ action: "edit", path: "a.ts", old: "x", new: "y", replace_all: false });
    const clean = cleanBoxArgs({ action: "edit", path: "a.ts", edits: [{ old: "a", new: "b" }, { old: "c", new: "d", replace_all: true }] })!;
    expect(clean.edits).toEqual([{ old: "a", new: "b" }, { old: "c", new: "d", replace_all: true }]);
    expect(renderBoxReply("edit", { ok: true, path: "a.ts", edits: 2, first_line: 7 })).toBe("edited a.ts: 2 change(s), first at line 7");
  });

  test("computer_publish commits every changed file and every deletion in ONE commit, with the token staying in the app", async () => {
    process.env.MODELSCOPE_API_TOKEN = "t";
    const studio = jest.fn(async (input: any, init?: any) => {
      const url = String(input);
      if (url.endsWith("/gradio_api/call/box_do")) { expect(JSON.parse(unb64(JSON.parse(String(init.body)).data[0]))).toMatchObject({ action: "changes", repo: "o/r", session: "7:coder" }); return new Response(JSON.stringify({ event_id: "e" }), { status: 200 }); }
      return new Response("event: complete\ndata: " + JSON.stringify([JSON.stringify({ ok: true, repo: "o/r", base: "b".repeat(40), files: [{ path: "src/a.ts", content: "export const a = 1;\n" }, { path: "docs/n.md", content: "# n\n" }], deleted: ["old.ts"], skipped: [{ path: "x.png", why: "binary" }] })]) + "\n\n", { status: 200 });
    }) as any;
    process.env.NOVA_MEDIA_STUDIO_URL = "https://studio-novaai2026-nova-media-server.api-inference.modelscope.net";
    const seen: { m: string; p: string; body?: any }[] = [];
    const gh = async (m: string, p: string, body?: any) => {
      seen.push({ m, p, body });
      if (p.endsWith("/git/ref/heads/fix-x")) return { status: 200, data: { object: { sha: "p1" } } };
      if (p.includes("/git/commits/p1")) return { status: 200, data: { tree: { sha: "t0" } } };
      if (p.endsWith("/git/blobs")) return { status: 201, data: { sha: "blob-" + seen.length } };
      if (p.endsWith("/git/trees")) return { status: 201, data: { sha: "t1" } };
      if (p.endsWith("/git/commits")) return { status: 201, data: { sha: "c1" } };
      if (p.includes("/git/refs/heads/")) return { status: 200, data: {} };
      return { status: 404, data: {} };
    };
    const out = await runTool(call("computer_publish", { repo: "o/r", branch: "fix-x", message: "fix things" }), { gh, addNote: () => undefined, userId: 7, modelId: "coder", fetchImpl: studio } as any);
    expect(out).toContain("2 file(s) changed, 1 deleted in ONE commit on fix-x");
    expect(out).toContain("x.png");                                                   // what was skipped is reported, not hidden
    expect(seen.filter((x) => x.p.endsWith("/git/commits") && x.m === "POST")).toHaveLength(1);
    const tree = seen.find((x) => x.p.endsWith("/git/trees"))!.body.tree;
    expect(tree).toEqual(expect.arrayContaining([expect.objectContaining({ path: "old.ts", sha: null }), expect.objectContaining({ path: "src/a.ts" }), expect.objectContaining({ path: "docs/n.md" })]));
    expect(seen.find((x) => x.p.endsWith("/git/commits"))!.body.message).toBe("fix things");
  });

  test("computer_publish uploads blobs with bounded concurrency and preserves tree order", async () => {
    process.env.MODELSCOPE_API_TOKEN = "t";
    const files = Array.from({ length: 9 }, (_, i) => ({ path: `src/${i}.ts`, content: `export const value${i} = ${i};` }));
    const studio = async (input: any) => String(input).endsWith("/call/box_do")
      ? new Response('{"event_id":"e"}', { status: 200 })
      : new Response("event: complete\ndata: " + JSON.stringify([JSON.stringify({ ok: true, repo: "o/r", base: "b".repeat(40), files, deleted: [], skipped: [] })]) + "\n\n", { status: 200 });
    let active = 0;
    let peak = 0;
    const seenPaths: string[] = [];
    const gh = async (method: string, path: string, body?: any) => {
      if (path.endsWith("/git/ref/heads/fix-x")) return { status: 200, data: { object: { sha: "p1" } } };
      if (path.includes("/git/commits/p1")) return { status: 200, data: { tree: { sha: "t0" } } };
      if (path.endsWith("/git/blobs")) {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        return { status: 201, data: { sha: `blob-${body.content}` } };
      }
      if (path.endsWith("/git/trees")) { seenPaths.push(...body.tree.map((item: any) => item.path)); return { status: 201, data: { sha: "t1" } }; }
      if (path.endsWith("/git/commits")) return { status: 201, data: { sha: "c1" } };
      if (path.includes("/git/refs/heads/")) return { status: 200, data: {} };
      return { status: 404, data: {} };
    };
    const out = await runTool(call("computer_publish", { repo: "o/r", branch: "fix-x", message: "parallel upload" }), { gh: gh as any, addNote: () => undefined, userId: 7, modelId: "coder", fetchImpl: studio as any } as any);
    expect(out).toContain("9 file(s) changed");
    expect(peak).toBe(4);
    expect(seenPaths).toEqual(files.map((file) => file.path));
  });

  test("an empty checkout, a missing GitHub link or a bad branch publish nothing", async () => {
    const none = jest.fn(async (input: any) => String(input).endsWith("/call/box_do") ? new Response(JSON.stringify({ event_id: "e" }), { status: 200 }) : new Response("event: complete\ndata: " + JSON.stringify([JSON.stringify({ ok: true, repo: "o/r", base: "", files: [], deleted: [], skipped: [] })]) + "\n\n", { status: 200 })) as any;
    const gh = jest.fn(async () => ({ status: 404, data: {} }));
    expect(await runTool(call("computer_publish", { repo: "o/r", branch: "b", message: "m" }), { gh, addNote: () => undefined, userId: 7, modelId: "coder", fetchImpl: none } as any)).toContain("nothing to publish");
    expect(await runTool(call("computer_publish", { repo: "o/r", branch: "b", message: "m" }), { gh: null, addNote: () => undefined, userId: 7, modelId: "coder" } as any)).toContain("GitHub is not connected");
    expect(await runTool(call("computer_publish", { repo: "o/r", branch: "bad branch!", message: "m" }), { gh, addNote: () => undefined, userId: 7, modelId: "coder" } as any)).toContain("branch");
    expect(await runTool(call("computer_publish", { repo: "not-a-repo", branch: "b", message: "m" }), { gh, addNote: () => undefined, userId: 7, modelId: "coder" } as any)).toContain("owner/name");
    expect(gh).not.toHaveBeenCalled();
  });

  test("publishing to a default or protected branch asks for confirmation like every other push", async () => {
    const gh = async (_m: string, p: string) => p === "/repos/o/r" ? { status: 200, data: { default_branch: "main" } } : p.includes("/branches/") ? { status: 200, data: { protected: false } } : { status: 404, data: {} };
    const guard = await guardCall(call("computer_publish", { repo: "o/r", branch: "main", message: "m" }), gh as any, "user");
    expect(guard.confirm).toBe(true);
  });
});

import { signedTarball as _signedTarball, cleanBoxArgs as _clean } from "@/lib/computerBox";
describe("private repositories reach the computer as a signed address, never the token", () => {
  const redirect = (loc: string, status = 302) => (async () => ({ status, headers: { get: (h: string) => (h.toLowerCase() === "location" ? loc : null) } })) as any;
  it("returns the short-lived codeload address from the redirect", async () => {
    expect(await _signedTarball("tok", "owner/repo", "", redirect("https://codeload.github.com/owner/repo/legacy.tar.gz/HEAD?token=ABC"))).toBe("https://codeload.github.com/owner/repo/legacy.tar.gz/HEAD?token=ABC");
  });
  it("refuses other hosts, non-redirects and bad repo names", async () => {
    expect(await _signedTarball("tok", "owner/repo", "", redirect("https://evil.example/x"))).toBeNull();
    expect(await _signedTarball("tok", "owner/repo", "", redirect("https://codeload.github.com/x", 200))).toBeNull();
    expect(await _signedTarball("tok", "../etc", "", redirect("https://codeload.github.com/x"))).toBeNull();
    expect(await _signedTarball("", "owner/repo", "", redirect("https://codeload.github.com/x"))).toBeNull();
  });
  it("only a codeload address passes the argument cleaner", () => {
    expect(_clean({ action: "repo", url: "https://github.com/o/r", signed_url: "https://codeload.github.com/o/r/x?token=1" })?.signed_url).toBe("https://codeload.github.com/o/r/x?token=1");
    expect(_clean({ action: "repo", url: "https://github.com/o/r", signed_url: "https://evil.example/x" })?.signed_url).toBeUndefined();
  });
});

describe("the owner's GitHub credentials reach the computer only as a token-shaped value for one call", () => {
  it("keeps a token-shaped GH_TOKEN and drops anything else", () => {
    expect(_clean({ action: "run", command: "git clone x", env: { GH_TOKEN: "ghp_abcdefghijklmnopqrstuvwxyz0123", PATH: "/evil" } } as any)?.env).toEqual({ GH_TOKEN: "ghp_abcdefghijklmnopqrstuvwxyz0123" });
    expect(_clean({ action: "run", command: "x", env: { GH_TOKEN: "short" } } as any)?.env).toBeUndefined();
    expect(_clean({ action: "run", command: "x", env: { GH_TOKEN: "a b; rm -rf /aaaaaaaaaaaaaaaa" } } as any)?.env).toBeUndefined();
  });
});
