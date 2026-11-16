// LIVE check (only by .github/workflows/computer-publish-live.yml): the REAL tool path a model uses to publish from the computer hub:
// computer_repo -> computer_write -> computer_publish (one commit on a throw-away branch) -> github_create_pr, then cleanup (PR closed, branch deleted).
import { runTool, githubClient } from "@/lib/coderAgent";

jest.setTimeout(600000);
const REPO = process.env.PUBLISH_REPO || "jonsnow-org/Ttbik";
const BRANCH = `zz-computer-publish-check-${Date.now()}`;

test("computer_publish pushes one commit and github_create_pr opens a PR", async () => {
  const token = (process.env.GH_PUSH_TOKEN || "").trim();
  expect(token).not.toBe("");
  const gh = githubClient(token);
  const notes: string[] = [];
  const ctx: any = { gh, addNote: (t: string) => notes.push(t), githubToken: token, userId: 777001, modelId: "nova", tier: "owner" };
  const call = (name: string, args: any) => runTool({ id: name, name, arguments: JSON.stringify(args) } as any, ctx);
  const log: string[] = [];
  let pr = 0;
  try {
    const repo = await call("computer_repo", { url: `https://github.com/${REPO}` });
    log.push("repo: " + repo.slice(0, 160));
    const folder = `repos/${REPO.replace("/", "-")}`;
    log.push("write: " + (await call("computer_write", { path: `${folder}/zz_publish_check.txt`, content: `publish check ${BRANCH}\n` })).slice(0, 120));
    const pub = await call("computer_publish", { repo: REPO, branch: BRANCH, message: "test: computer publish check (throw-away)" });
    log.push("publish: " + pub.slice(0, 400));
    expect(pub).toMatch(/published/);
    const head = await gh("GET", `/repos/${REPO}/branches/${encodeURIComponent(BRANCH)}`);
    log.push(`branch on GitHub: ${head.status} commit ${head.data?.commit?.sha}`);
    expect(head.status).toBe(200);
    const def = (await gh("GET", `/repos/${REPO}`)).data.default_branch;
    const prRes = await call("github_create_pr", { repo: REPO, head: BRANCH, base: def, title: "Throw-away: computer publish check", body: "Automatic live check; closed right away." });
    log.push("pr: " + prRes.slice(0, 200));
    expect(prRes).toMatch(/PR #\d+/);
    pr = Number(/PR #(\d+)/.exec(prRes)?.[1] || 0);
  } finally {
    if (pr) log.push("close PR: " + (await gh("PATCH", `/repos/${REPO}/pulls/${pr}`, { state: "closed" })).status);
    log.push("delete branch: " + (await gh("DELETE", `/repos/${REPO}/git/refs/heads/${encodeURIComponent(BRANCH)}`)).status);
    console.log("PUBLISH_LIVE " + JSON.stringify(log, null, 1));
  }
});
