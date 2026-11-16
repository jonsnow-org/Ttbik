import { goalKeywords, repoFolderOf, docsHintsAfterRepo, filesOf } from "../coderGoalHints";

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

  test("long doc lines keep their file name, and a Latin handle is searched in the source: its files are listed", async () => {
    const goal = "ابحث عن بوت سلاسل يومية @Slaselbot له تطبيق مصغر";
    expect(goalKeywords(goal)).toEqual(["سلاسل", "يومية", "Slaselbot"]);
    const calls: string[] = [];
    const hint = await docsHintsAfterRepo("repository ready in ~/repos/a-b (1s)", goal, async ({ pattern, path }) => {
      calls.push(`${pattern}@${path}`);
      return path.endsWith("/docs")
        ? "repos/a-b/docs/WORK_BOARD.md:102:[Omitted long matching line]"
        : "repos/a-b/src/lib/__tests__/x.test.ts:3:Slaselbot\nrepos/a-b/src/lib/streakBotLogic.ts:9:@Slaselbot\nrepos/a-b/src/app/bot-app/StreakMiniApp.tsx:4:Slaselbot";
    });
    expect(calls).toEqual(["سلاسل|يومية|Slaselbot@repos/a-b/docs", "Slaselbot@repos/a-b/src"]);
    expect(hint).toMatch(/docs\/WORK_BOARD\.md:102\n|docs\/WORK_BOARD\.md:102$/);
    expect(hint).not.toMatch(/Omitted/);
    expect(hint.indexOf("streakBotLogic.ts")).toBeLessThan(hint.indexOf("x.test.ts"));       // tests are listed last
    expect(hint).toMatch(/StreakMiniApp\.tsx/);
  });
  test("filesOf: unique paths, tests last, bounded", () => {
    expect(filesOf("a/t.test.ts:1:x\nb.ts:2:y\nb.ts:9:z\nc.ts:1:q", 3)).toEqual(["b.ts", "c.ts", "a/t.test.ts"]);
  });
});
