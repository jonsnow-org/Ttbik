import { boxActionFor, boxDo, cleanBoxArgs, renderBoxReply } from "@/lib/computerBox";
import { COMPUTER_PLAYBOOK, toolGroups } from "@/lib/coderAgent";
import { candidateToolsFor } from "@/lib/donorToolBridge";

describe("the model's own persistent computer", () => {
  test("the four tools map to the Studio's actions and nothing else", () => {
    expect(boxActionFor("computer_run", { command: "ls", timeout: 5 })).toMatchObject({ action: "run", command: "ls", timeout: 5 });
    expect(boxActionFor("computer_write", { path: "a.txt", content: "x" })).toMatchObject({ action: "write", path: "a.txt" });
    expect(boxActionFor("computer_read", {})).toMatchObject({ action: "read", path: "." });
    expect(boxActionFor("computer_job", { action: "start", command: "sleep 1" })).toMatchObject({ action: "job_start" });
    expect(boxActionFor("computer_job", { action: "format" })).toBeNull();
    expect(boxActionFor("computer_repo", { url: "https://github.com/a/b", ref: "main" })).toEqual({ action: "repo", url: "https://github.com/a/b", ref: "main" });
    expect(boxActionFor("computer_search", { pattern: "needle", glob: "*.ts" })).toMatchObject({ action: "search", pattern: "needle", path: ".", glob: "*.ts" });
    expect(boxActionFor("sandbox_exec", {})).toBeNull();
  });

  test("fields are bounded before they reach the Studio", () => {
    const clean = cleanBoxArgs({ action: "run", command: "x".repeat(20000), timeout: 9999, cwd: "src" })!;
    expect(String(clean.command).length).toBe(8000);
    expect(clean.timeout).toBe(90);
    expect(cleanBoxArgs({ action: "rm" })).toBeNull();
    expect(cleanBoxArgs({ action: "job_log", id: "abcdefgh", tail: 9999 })).toEqual({ action: "job_log", id: "abcdefgh", tail: 400 });
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
    expect(calls[0].url).toContain("sham-donor-minicpmo45-media");
    expect(JSON.parse(calls[0].body.data[0])).toEqual({ action: "run", command: "echo hello", session: "42:minicpmo45" });
    expect(await boxDo("sham_v2", "1:x", { action: "run", command: "ls" }, fetchImpl)).toMatch(/no computer Studio/);
  });

  test("the computer group carries the four tools for Nova and the candidates, with short descriptions that keep the 90 s rule", () => {
    const names = (toolGroups(false, false).computer || []).map((t) => t.function.name);
    for (const name of ["computer_run", "computer_write", "computer_read", "computer_job", "computer_repo", "computer_search", "browser"]) expect(names).toContain(name);
    expect(COMPUTER_PLAYBOOK).toContain("computer_repo");
    expect(COMPUTER_PLAYBOOK).toContain("computer_job");
    const seen = candidateToolsFor(["computer"], false, false).find((t) => t.function.name === "computer_run")!;
    expect(seen.function.description).toContain("90 s");
    expect(seen.function.description).toContain("computer_job");
  });
});
