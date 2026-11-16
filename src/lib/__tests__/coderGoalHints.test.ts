import { goalKeywords, repoFolderOf, docsHintsAfterRepo } from "../coderGoalHints";

const GOAL = "اذهب للمستودع موقع شام آي يحتوي بوتات وادوات مجانية وابحث عن بوت سلاسل يومية يوجد له تطبيق مصغر وقم باصلاح وتطوير البوت والتطبيق المصغر بشكل كامل\n jonsnow-org/Ttbik";

describe("finding the owner's project by his own words", () => {
  test("keywords keep the distinctive nouns and drop the generic request words", () => {
    expect(goalKeywords(GOAL)).toEqual(["سلاسل", "يومية"]);
  });
  test("the folder comes from the computer_repo answer", () => {
    expect(repoFolderOf("repository ready in ~/repos/jonsnow-org-Ttbik (18s)\nfiles: 3000")).toBe("repos/jonsnow-org-Ttbik");
    expect(repoFolderOf("error: nope")).toBe("");
  });
  test("the matching doc lines are appended; nothing is added when the search finds nothing", async () => {
    const seen: string[] = [];
    const hint = await docsHintsAfterRepo("repository ready in ~/repos/a-b (1s)", GOAL, async ({ pattern, path }) => { seen.push(pattern + "@" + path); return "docs/agents/telegram-bots.md:41:STREAK_BOT hosts the daily chains\n"; });
    expect(seen).toEqual(["سلاسل|يومية@repos/a-b/docs"]);
    expect(hint).toMatch(/STREAK_BOT/);
    expect(await docsHintsAfterRepo("repository ready in ~/repos/a-b (1s)", GOAL, async () => "no matches")).toBe("");
    expect(await docsHintsAfterRepo("error: x", GOAL, async () => "x")).toBe("");
  });
});
