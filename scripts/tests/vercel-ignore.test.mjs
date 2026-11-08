import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = readFileSync(new URL("../vercel-ignore.sh", import.meta.url), "utf8");
function repo() {
  const d = mkdtempSync(join(tmpdir(), "vig-"));
  const git = (...a) => execFileSync("git", a, { cwd: d, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" }, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  const commit = (file, msg, when) => {
    mkdirSync(join(d, file, ".."), { recursive: true });
    writeFileSync(join(d, file), String(Math.random()));
    git("add", "-A");
    execFileSync("git", ["commit", "-q", "-m", msg], { cwd: d, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } });
    return git("rev-parse", "HEAD");
  };
  writeFileSync(join(d, "ignore.sh"), script);
  return { d, git, commit };
}
const run = (d, prev, env = {}) => spawnSync("sh", ["ignore.sh"], { cwd: d, env: { ...process.env, VERCEL_GIT_PREVIOUS_SHA: prev || "", VERCEL_ENV: "production", ...env } }).status;
const T0 = "2026-11-08T10:00:00Z", T10 = "2026-11-08T10:10:00Z", T3H = "2026-11-08T13:00:00Z";

test("docs/ai-system-only commits are skipped", () => {
  const { d, commit } = repo(); const a = commit("src/lib/x.ts", "site", T0); const b = commit("ai-system/train.py", "sham", T3H);
  assert.equal(run(d, a), 0);
});
test("a site commit right after the last deployed one is skipped (throttle)", () => {
  const { d, commit } = repo(); const a = commit("src/lib/x.ts", "site 1", T0); commit("src/lib/y.ts", "site 2", T10);
  assert.equal(run(d, a), 0);
});
test("a site commit hours after the last deployed one builds", () => {
  const { d, commit } = repo(); const a = commit("src/lib/x.ts", "site 1", T0); commit("src/lib/y.ts", "site 2", T3H);
  assert.equal(run(d, a), 1);
});
test("[deploy] in the message forces a build inside the window", () => {
  const { d, commit } = repo(); const a = commit("src/lib/x.ts", "site 1", T0); commit("src/lib/y.ts", "site 2 [deploy]", T10);
  assert.equal(run(d, a), 1);
});
test("package.json / vercel.json changes always build", () => {
  const { d, commit } = repo(); const a = commit("src/lib/x.ts", "site 1", T0); commit("package.json", "deps", T10);
  assert.equal(run(d, a), 1);
});
test("a merge commit always builds", () => {
  const { d, git, commit } = repo(); const a = commit("src/lib/x.ts", "base", T0);
  git("checkout", "-q", "-b", "side"); commit("src/lib/s.ts", "side", T10);
  git("checkout", "-q", "main"); commit("src/lib/m.ts", "main", T10);
  execFileSync("git", ["merge", "-q", "--no-ff", "-m", "merge", "side"], { cwd: d, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  assert.equal(run(d, a), 1);
});
test("previews never build", () => {
  const { d, commit } = repo(); const a = commit("src/lib/x.ts", "site 1", T0); commit("src/lib/y.ts", "site 2", T3H);
  assert.equal(run(d, a, { VERCEL_ENV: "preview" }), 0);
});
