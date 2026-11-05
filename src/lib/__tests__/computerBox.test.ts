import { boxActionFor, boxDo, cleanBoxArgs, renderBoxReply } from "@/lib/computerBox";
import { COMPUTER_PLAYBOOK, toolGroups } from "@/lib/coderAgent";
const unb64 = (x: string): string => (x.startsWith("b64:") ? Buffer.from(x.slice(4), "base64").toString("utf8") : x);   // jobs travel as base64 (the gateway filter rejects some plain text)
import { candidateToolsFor } from "@/lib/donorToolBridge";

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

  test("the model can inspect installed apps and use its private persistent bank network", () => {
    expect(boxActionFor("computer_apps", {})).toEqual({ action: "apps" });
    const mapped = boxActionFor("computer_bank", { action: "put", bank: "documents", source_path: "reports/guide.pdf", kind: "document", metadata: { lang: "ar" }, offset: 12 });
    expect(mapped).toMatchObject({ action: "bank", bank_action: "put", bank: "documents", source_path: "reports/guide.pdf", kind: "document", offset: 12 });
    const link = boxActionFor("computer_bank", { action: "link", bank: "documents", target_bank: "datasets", relation: "references", note: "project data" });
    expect(link).toMatchObject({ action: "bank", bank_action: "link", target_bank: "datasets", relation: "references", note: "project data" });
    expect(cleanBoxArgs(mapped!)).toMatchObject({ action: "bank", bank_action: "put", source_path: "reports/guide.pdf", offset: 12 });
    expect(renderBoxReply("bank", { ok: true, action: "put", item_id: "abc", deduplicated: true })).toContain("deduplicated");
    expect(renderBoxReply("apps", { ok: true, apps: { writer: true, tesseract_arabic: false } })).toContain("tesseract_arabic");
    const names = toolGroups(true, false).computer.map((item) => item.function.name);
    expect(names).toContain("computer_bank");
    expect(names).toContain("computer_apps");
    expect(COMPUTER_PLAYBOOK).toMatch(/private computer bank network/);
  });

  test("fields are bounded before they reach the Studio", () => {
    const clean = cleanBoxArgs({ action: "run", command: "x".repeat(20000), timeout: 9999, cwd: "src" })!;
    expect(String(clean.command).length).toBe(8000);
    expect(clean.timeout).toBe(90);
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

  test("a command goes to the model's own Studio with the user+model session", async () => {
    process.env.MODELSCOPE_API_TOKEN = "t";
    const calls: { url: string; body?: any }[] = [];
    const fetchImpl = jest.fn(async (input: any, init?: any) => {
      const url = String(input);
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith("/gradio_api/call/box_do")) return new Response(JSON.stringify({ event_id: "e1" }), { status: 200 });
      return new Response("event: complete\ndata: " + JSON.stringify([JSON.stringify({ ok: true, exit_code: 0, seconds: 0.1, cwd: ".", output: "hello" })]) + "\n\n", { status: 200 });
    }) as any;
    const out = await boxDo("minicpmo45", "42:minicpmo45", { action: "run", command: "echo hello" }, fetchImpl);
    expect(out).toContain("hello");
    expect(calls[0].url).toContain("nova-inference-server");
    expect(JSON.parse(unb64(calls[0].body.data[0]))).toEqual({ action: "run", command: "echo hello", session: "42:minicpmo45" });
    expect(await boxDo("sham_v2", "1:x", { action: "run", command: "ls" }, fetchImpl)).toMatch(/hello/);
    expect(calls[2].url).toContain("nova-inference-server");
  });

  test("persistent computer and temporary worker are separate tool groups", () => {
    const computer = (toolGroups(false, false).computer || []).map((t) => t.function.name);
    const worker = (toolGroups(false, false).worker || []).map((t) => t.function.name);
    for (const name of ["computer_run", "computer_write", "computer_read", "computer_job", "computer_repo", "computer_search", "browser"]) expect(computer).toContain(name);
    expect(computer).not.toContain("sandbox_exec");
    expect(worker).toEqual(expect.arrayContaining(["sandbox_clone", "sandbox_exec", "sandbox_wait", "sandbox_search"]));
    expect(COMPUTER_PLAYBOOK).toContain("computer_repo");
    expect(COMPUTER_PLAYBOOK).toContain("computer_job");
    const seen = candidateToolsFor(["computer"], false, false).find((t) => t.function.name === "computer_run")!;
    expect(seen.function.description).toContain("90 s");
    expect(seen.function.description).toContain("computer_job");
    expect(candidateToolsFor(["computer"], false, false).map((t) => t.function.name)).not.toContain("sandbox_exec");
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

  test("publishing to a default or protected branch asks for confirmation like every other push, and candidates can publish like Nova (the same confirmation)", async () => {
    const gh = async (_m: string, p: string) => p === "/repos/o/r" ? { status: 200, data: { default_branch: "main" } } : p.includes("/branches/") ? { status: 200, data: { protected: false } } : { status: 404, data: {} };
    const guard = await guardCall(call("computer_publish", { repo: "o/r", branch: "main", message: "m" }), gh as any, "user");
    expect(guard.confirm).toBe(true);
    const names = candidateToolsFor(["computer", "github"], true, false).map((t) => t.function.name);
    expect(names).toContain("computer_publish");                          // owner 2026-11-02: candidates have the same tools as Nova; a push to a default / protected branch still asks (guard above)
    expect(names).toContain("computer_edit");
  });
});
