/**
 * Finding WHICH project the owner means (owner order 2026-11-16; three live runs opened media-bot when he asked for the daily-chains bot): right after the repository
 * is on the computer, the harness itself searches the repository's docs for the key words of his request and appends the matching lines to the repository result,
 * so the model starts from the right files instead of guessing a folder. No model step, no extra Studio call.
 */
const STOP = new Set([
  "اذهب", "المستودع", "للمستودع", "والمستودع", "بالمستودع", "مستودع", "وابحث", "ابحث", "يوجد", "تطبيق", "مصغر", "بشكل", "كامل", "باصلاح", "واصلاح", "وتطوير", "اصلاح", "إصلاح", "تطوير", "موقع", "يحتوي", "بوتات", "وادوات", "ادوات", "أدوات",
  "مجانية", "وقم", "قم", "الذي", "التي", "هذا", "هذه", "عنه", "منه", "على", "الى", "إلى", "بوت", "وطور", "طور", "اصلح", "أصلح", "وأصلح", "والتطبيق", "للبوت", "البوت", "والبوت", "بالبوت", "للتطبيق", "المصغر", "والمصغر",
  "jonsnow", "ttbik", "repo", "github", "with", "that", "have", "from", "into", "fix", "develop", "find", "search", "bot", "mini",
]);

export function goalKeywords(goal: string, max = 3): string[] {
  const words = (String(goal || "").match(/[؀-ۿ]{4,}|[A-Za-z]{4,}/g) || []).map((w) => w.trim());
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words) {
    const k = w.toLowerCase();
    if (STOP.has(w) || STOP.has(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(w);
  }
  return out.slice(0, max);
}

/** The repository folder named by computer_repo's answer ("repository ready in ~/repos/<owner>-<name> …"), or "". */
export function repoFolderOf(result: string): string {
  const m = /repository ready in ~\/(\S+)/.exec(String(result || ""));
  return m ? m[1].replace(/[)\].,;]+$/, "") : "";
}

export async function docsHintsAfterRepo(repoResult: string, goal: string, search: (args: { pattern: string; path: string }) => Promise<string>): Promise<string> {
  const folder = repoFolderOf(repoResult);
  const words = goalKeywords(goal);
  if (!folder || !words.length) return "";
  let found = "";
  try { found = String(await search({ pattern: words.join("|"), path: `${folder}/docs` })); } catch { return ""; }
  const lines = found.split("\n").map((l) => l.trim()).filter((l) => l && !/^error/i.test(l) && !/no matches|0 matches/i.test(l)).slice(0, 14);
  if (!lines.length) return "";
  const text = lines.join("\n").slice(0, 2200);
  return `\n\n[harness] The owner's own words (${words.join(", ")}) appear in the repository docs here; the project he means is named in these lines, start from its files:\n${text}`;
}
