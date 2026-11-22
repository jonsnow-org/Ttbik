/**
 * Computer first (owner order 2026-11-14: "everything Nova does goes through the computer"). In the live task of 2026-11-15 Nova read the repository
 * with GitHub API tools (scan, list, read, code search), 7 of its 11 calls, and fetched nothing to its computer. For the owner, the first GitHub READ calls of a run are answered
 * with an instruction to use computer_repo instead of executing them (at most twice per run, so a hub outage cannot trap the run).
 */
const GITHUB_READ = new Set(["github_repo_scan", "github_list_files", "github_search_code", "github_repo_audit"]);
const redirected = new Map<string, number>();
const GITHUB_FILE_READ = new Set(["github_read_file", "github_read_files"]);
const repoReady = new Set<string>();      // runs whose repository is already on the computer

/** Called when computer_repo succeeded for a run: from then on single-file GitHub reads are answered with computer_read too (the files are right there). */
export function markRepoOnComputer(runId: string | undefined): void {
  if (!runId) return;
  repoReady.add(runId);
  if (repoReady.size > 500) for (const k of [...repoReady].slice(0, 250)) repoReady.delete(k);
}

export function isGithubRead(name: string): boolean {
  return GITHUB_READ.has(name);
}

export function computerFirstRedirect(name: string, args: Record<string, unknown>, tier: string | undefined, runId: string | undefined, hasComputer: boolean): string {
  if (tier !== "owner" || !hasComputer || !runId) return "";
  if (GITHUB_FILE_READ.has(name) && repoReady.has(runId)) {
    return "[harness] Not executed: this repository is already on YOUR computer. Read the file with computer_read (path under the folder computer_repo reported) or find it with computer_search; GitHub API reads are not used for files you already have.";
  }
  if (!GITHUB_READ.has(name)) return "";
  const n = redirected.get(runId) || 0;
  if (n >= 2) return "";
  redirected.set(runId, n + 1);
  if (redirected.size > 500) for (const k of [...redirected.keys()].slice(0, 250)) redirected.delete(k);
  const repo = /^[\w.-]+\/[\w.-]+$/.test(String(args.repo || "")) ? String(args.repo) : "";
  const url = repo ? `https://github.com/${repo}` : "https://github.com/<owner>/<repo>";
  return `[harness] Not executed. Owner order: repository work runs on YOUR computer, not through GitHub API reads. Call computer_repo with url=${url} (ONE call, private repositories work), `
    + "then use computer_search to find things and computer_read to read files, computer_edit/computer_write to change them, computer_test to check, and computer_publish to send the change. "
    + "To decide WHICH project or bot the owner means, first search his own words (the key nouns of his request, in Arabic as he wrote them) over docs/ and AGENTS.md with computer_search (the repository's docs map names every bot and its files); never pick a folder just because it has a README.";
}
