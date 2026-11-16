import { computerFirstRedirect, isGithubRead } from "../coderComputerFirst";

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
