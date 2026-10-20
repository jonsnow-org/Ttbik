import { classifyCall, classifyWorkflow, guardCall, githubClient } from "@/lib/coderAgent";
import { decryptToken, encryptToken, resolveConnections, saveConnection, tierFor, type Db } from "@/lib/coderAuth";

const call = (name: string, args: object) => ({ id: "c", type: "function" as const, function: { name, arguments: JSON.stringify(args) } });
const b64 = (t: string) => Buffer.from(t).toString("base64");

// a small GitHub: default branch "main", "release" is protected, two workflows (tests only / deploy) and one that pushes commits
function mockGithub() {
  (global as any).fetch = jest.fn(async (url: string, init?: any) => {
    const path = url.replace("https://api.github.com", "");
    const m = (init?.method || "GET") + " " + path.split("?")[0];
    const J = (status: number, data: unknown) => new Response(JSON.stringify(data), { status });
    if (m === "GET /repos/o/r") return J(200, { default_branch: "main" });
    if (m === "GET /repos/o/r/branches/release") return J(200, { protected: true });
    if (m.startsWith("GET /repos/o/r/branches/")) return J(200, { protected: false });
    if (m === "GET /repos/o/r/pulls/1") return J(200, { base: { ref: "main" } });
    if (m === "GET /repos/o/r/pulls/2") return J(200, { base: { ref: "feature-x" } });
    if (m === "GET /repos/o/r/contents/.github/workflows/test.yml") return J(200, { content: b64("on: workflow_dispatch\njobs:\n  t:\n    steps:\n      - run: npm ci && npm test") });
    if (m === "GET /repos/o/r/contents/.github/workflows/ship.yml") return J(200, { content: b64("jobs:\n  d:\n    steps:\n      - run: npx vercel deploy --prod") });
    if (m === "GET /repos/o/r/contents/.github/workflows/bump.yml") return J(200, { content: b64("permissions:\n  contents: write\njobs:\n  b:\n    steps:\n      - run: git commit -am bump && git push") });
    return J(404, { message: "nope" });
  });
}

const gh = githubClient("t");
const asks = async (tier: "owner" | "user", c: ReturnType<typeof call>) => (await guardCall(c, gh, tier)).confirm;

beforeEach(mockGithub);

describe("regular user tier", () => {
  it("runs reading, planning, branches, feature pushes, PRs, CI checks and test workflows without asking", async () => {
    for (const c of [
      call("github_read_file", { repo: "o/r", path: "a.ts" }),
      call("github_search_code", { repo: "o/r", query: "x" }),
      call("github_create_branch", { repo: "o/r", branch: "feature-x" }),
      call("github_write_files", { repo: "o/r", branch: "feature-x", message: "m", files: [{ path: "a", content: "1" }] }),
      call("github_create_pr", { repo: "o/r", head: "feature-x", title: "t" }),
      call("github_ci_status", { repo: "o/r", ref: "feature-x" }),
      call("github_run_workflow", { repo: "o/r", workflow: "test.yml", ref: "feature-x" }),
      call("github_merge_pr", { repo: "o/r", number: 2 }),
      call("github_create_release", { repo: "o/r", tag: "v1", draft: true }),
      call("github_api", { method: "POST", path: "/repos/o/r/issues/3/comments", body: { body: "hi" } }),
      call("memory_note", { text: "plan" }),
    ]) expect(await asks("user", c)).toBe(false);
  });
  it("asks for every consequential action", async () => {
    for (const c of [
      call("github_delete_files", { repo: "o/r", branch: "feature-x", message: "m", paths: ["a"] }),
      call("github_delete_branch", { repo: "o/r", branch: "feature-x" }),
      call("github_delete_repo", { repo: "o/r" }),
      call("github_delete_release", { repo: "o/r", id: 5 }),
      call("github_write_files", { repo: "o/r", branch: "main", message: "m", files: [] }),
      call("github_write_files", { repo: "o/r", branch: "release", message: "m", files: [] }),
      call("github_merge_pr", { repo: "o/r", number: 1 }),
      call("github_update_ref", { repo: "o/r", branch: "feature-x", sha: "abc", force: true }),
      call("github_run_workflow", { repo: "o/r", workflow: "ship.yml", ref: "feature-x" }),
      call("github_run_workflow", { repo: "o/r", workflow: "bump.yml", ref: "feature-x" }),
      call("github_run_workflow", { repo: "o/r", workflow: "unreadable.yml", ref: "feature-x" }),
      call("github_update_repo", { repo: "o/r", settings: { private: false } }),
      call("github_add_collaborator", { repo: "o/r", user: "x" }),
      call("github_create_release", { repo: "o/r", tag: "v1" }),
      call("github_api", { method: "PUT", path: "/repos/o/r/actions/secrets/X", body: {} }),
      call("github_api", { method: "DELETE", path: "/repos/o/r/hooks/1" }),
      call("github_api", { method: "PATCH", path: "/repos/o/r/git/refs/heads/feature-x", body: { sha: "a", force: true } }),
      call("github_api", { method: "PUT", path: "/repos/o/r/contents/a.ts", body: { message: "m", content: "eA==" } }),
    ]) expect(await asks("user", c)).toBe(true);
  });
});

describe("owner tier", () => {
  it("asks only for deletes and pushes/merges into main/default (incl. a workflow that commits)", async () => {
    for (const c of [
      call("github_delete_branch", { repo: "o/r", branch: "feature-x" }),
      call("github_delete_files", { repo: "o/r", branch: "feature-x", message: "m", paths: ["a"] }),
      call("github_write_files", { repo: "o/r", branch: "main", message: "m", files: [] }),
      call("github_merge_pr", { repo: "o/r", number: 1 }),
      call("github_update_ref", { repo: "o/r", branch: "main", sha: "abc" }),
      call("github_run_workflow", { repo: "o/r", workflow: "bump.yml", ref: "main" }),
      call("github_api", { method: "DELETE", path: "/repos/o/r/releases/9" }),
    ]) expect(await asks("owner", c)).toBe(true);
  });
  it("everything else runs without asking", async () => {
    for (const c of [
      call("github_write_files", { repo: "o/r", branch: "release", message: "m", files: [] }),
      call("github_update_ref", { repo: "o/r", branch: "feature-x", sha: "abc", force: true }),
      call("github_run_workflow", { repo: "o/r", workflow: "ship.yml", ref: "main" }),
      call("github_update_repo", { repo: "o/r", settings: { has_wiki: false } }),
      call("github_add_collaborator", { repo: "o/r", user: "x" }),
      call("github_create_release", { repo: "o/r", tag: "v1" }),
      call("github_api", { method: "PUT", path: "/repos/o/r/actions/secrets/X", body: {} }),
      call("github_merge_pr", { repo: "o/r", number: 2 }),
    ]) expect(await asks("owner", c)).toBe(false);
  });
  it("labels the reason in Arabic", async () => {
    const g = await guardCall(call("github_write_files", { repo: "o/r", branch: "main", message: "m", files: [] }), gh, "owner");
    expect(g.confirm && g.reason).toBe("دفع إلى الفرع الأساسي");
    expect((await classifyCall(call("github_delete_repo", { repo: "o/r" }), gh)).risks).toEqual(["delete"]);
  });
  it("classifies workflow files by their own text", () => {
    expect(classifyWorkflow("ci.yml", "run: npm test")).toEqual({ deploys: false, writes: false });
    expect(classifyWorkflow("deploy-x.yml", "run: echo")).toEqual({ deploys: true, writes: false });
    expect(classifyWorkflow("x.yml", null).deploys).toBe(true);
  });
});

describe("credentials per tier", () => {
  function db(): Db & { conns: any[] } {
    const conns: any[] = [];
    return {
      conns,
      exec: async (_s: string, ...a: unknown[]) => { conns.push({ chat_key: a[0], provider: a[1], token_enc: a[2], login: a[3] }); },
      query: async <T,>(_s: string, k: unknown) => conns.filter((c) => c.chat_key === k) as T[],
    };
  }
  beforeEach(() => {
    process.env.SUPER_ADMIN_TELEGRAM_ID = "1";
    process.env.CODER_GITHUB_TOKEN = "owner-token";
    process.env.CODER_TOKEN_KEY = "k".repeat(32);
  });
  it("owner gets the owner token; a user never does, only their own linked one", async () => {
    const d = db();
    expect(tierFor(1)).toBe("owner");
    expect(tierFor(2)).toBe("user");
    expect((await resolveConnections(1, d)).github?.token).toBe("owner-token");
    expect((await resolveConnections(2, d)).github).toBeUndefined();
    await saveConnection(2, "github", "user-token", "alice", d);
    expect(d.conns[0].token_enc).not.toContain("user-token");
    const c = await resolveConnections(2, d);
    expect(c.github).toEqual({ token: "user-token", source: "user-link", login: "alice" });
  });
  it("encrypts with AES-GCM and refuses tampered data", () => {
    const e = encryptToken("secret");
    expect(decryptToken(e)).toBe("secret");
    expect(decryptToken(e.slice(0, -4) + "AAAA")).toBeNull();
  });
});
