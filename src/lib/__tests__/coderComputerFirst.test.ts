import { computerFirstRedirect, isGithubRead, markRepoOnComputer } from "../coderComputerFirst";

describe("computer first for the owner", () => {
  test("the first two GitHub read calls of an owner run are redirected to computer_repo, then they pass through", () => {
    const a = computerFirstRedirect("github_repo_scan", { repo: "jonsnow-org/Ttbik" }, "owner", "run-a", true);
    expect(a).toMatch(/computer_repo with url=https:\/\/github\.com\/jonsnow-org\/Ttbik/);
    expect(a).toMatch(/his own words/);
    expect(computerFirstRedirect("github_list_files", {}, "owner", "run-a", true)).toMatch(/computer_repo/);
    expect(computerFirstRedirect("github_search_code", {}, "owner", "run-a", true)).toBe("");
  });
  test("not for other users, writes, other tools, or when no computer is available", () => {
    expect(computerFirstRedirect("github_repo_scan", {}, "user", "run-b", true)).toBe("");
    expect(computerFirstRedirect("github_create_pr", {}, "owner", "run-c", true)).toBe("");
    expect(computerFirstRedirect("github_repo_scan", {}, "owner", "run-d", false)).toBe("");
    expect(isGithubRead("computer_read")).toBe(false);
  });
});

import { queueMoveAfterMs } from "../coderSections";
describe("queue move keeps a warm cache", () => {
  test("small or first-step prompts move fast, big warm ones wait", () => {
    expect(queueMoveAfterMs({ step: 0, promptEst: 30000 })).toBe(1500);
    expect(queueMoveAfterMs({ step: 5, promptEst: 3000 })).toBe(1500);
    expect(queueMoveAfterMs({ step: 5, promptEst: 25000 })).toBe(300000);
  });
});

describe("a bot handle inside a named repository is a lookup, not a repository read", () => {
  test("github_search_code for one handle is executed instead of being sent to computer_repo", () => {
    // live 2026-11-24: «@Slaselbot» inside «메ستودعنا» was never searched because this call was replaced by "call computer_repo"
    expect(computerFirstRedirect("github_search_code", { repo: "jonsnow-org/Ttbik", query: "Slaselbot" }, "owner", "run-lookup", true)).toBe("");
    expect(computerFirstRedirect("github_search_code", { repo: "jonsnow-org/Ttbik", query: "@Slaselbot" }, "owner", "run-lookup2", true)).toBe("");
  });
  test("a phrase, a missing repository or a bulk scan still goes to the computer", () => {
    expect(computerFirstRedirect("github_search_code", { repo: "jonsnow-org/Ttbik", query: "where is the daily streak bot defined" }, "owner", "run-lookup3", true)).toMatch(/computer_repo/);
    expect(computerFirstRedirect("github_search_code", { query: "Slaselbot" }, "owner", "run-lookup4", true)).toMatch(/computer_repo/);
    expect(computerFirstRedirect("github_repo_scan", { repo: "jonsnow-org/Ttbik", query: "Slaselbot" }, "owner", "run-lookup5", true)).toMatch(/computer_repo/);
  });
});

describe("single-file GitHub reads once the repository is on the computer", () => {
  test("redirected to computer_read only after computer_repo succeeded for that run, owner only", () => {
    expect(computerFirstRedirect("github_read_file", {}, "owner", "run-r", true)).toBe("");
    markRepoOnComputer("run-r");
    expect(computerFirstRedirect("github_read_file", {}, "owner", "run-r", true)).toMatch(/computer_read/);
    expect(computerFirstRedirect("github_read_files", {}, "owner", "run-r", true)).toMatch(/computer_read/);
    expect(computerFirstRedirect("github_read_file", {}, "user", "run-r", true)).toBe("");
    expect(computerFirstRedirect("github_read_file", {}, "owner", "other-run", true)).toBe("");
  });
});
