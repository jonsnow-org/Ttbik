import { finishNudge, madeChanges, worthALesson, toolNamesIn } from "../coderFinishGate";

const GOAL = "اذهب للمستودع وابحث عن بوت سلاسل يومية يوجد له تطبيق مصغر قم باصلاح وتطوير البوت والتطبيق المصغر بشكل كامل";
const MENU = "بناءً على تحليلي وجدت البوت. هل تريد أن أقوم بإصلاح الكود؟ أخبرني بالخطوة التي تريد البدء بها!";

describe("owner finish gate", () => {
  test("an action request that ended with a menu and no change is sent back to work, twice at most", () => {
    const read = ["github_repo_scan", "github_read_files", "computer_search"];
    expect(finishNudge(GOAL, read, MENU, 0)).toMatch(/computer_repo/);
    expect(finishNudge(GOAL, read, MENU, 1)).not.toBe("");
    expect(finishNudge(GOAL, read, MENU, 2)).not.toBe("");
    expect(finishNudge(GOAL, read, MENU, 3)).toBe("");
  });
  test("a run that changed something, or a question that asked for no action, ends normally", () => {
    expect(finishNudge(GOAL, ["computer_edit"], "تم الإصلاح", 0)).toBe("");
    expect(finishNudge("ما هو أفضل مكتبة للرسوم؟", [], "أنصح بكذا وكذا لأن السبب طويل", 0)).toBe("");
    expect(finishNudge(GOAL, [], "نعم", 0)).toBe("");
  });
  test("only runs that changed something become lessons", () => {
    expect(worthALesson(GOAL, ["github_read_files"])).toBe(false);
    expect(worthALesson(GOAL, ["computer_publish"])).toBe(true);
    expect(worthALesson("من انت", [])).toBe(true);
    expect(madeChanges(["computer_run", "computer_test"])).toBe(false);
  });
  test("tool names are read from the messages", () => {
    expect(toolNamesIn([{ tool_calls: [{ function: { name: "computer_edit" } }] }, {}])).toEqual(["computer_edit"]);
  });

  test("a report of changes with no change call is sent back, whatever the goal", () => {
    const report = "تم إصلاح وتطوير البوت. تحسينات في config.py: إضافة type hints كاملة";
    expect(finishNudge("البوت هو @Slaselbot", ["computer_read", "computer_search"], report, 0)).toMatch(/NO edit/);
    expect(finishNudge("البوت هو @Slaselbot", ["computer_edit"], report, 0)).toBe("");
    expect(finishNudge("ما هو أفضل مكتبة؟", [], "أنصح بكذا لأن السبب طويل وواضح", 0)).toBe("");
  });
});
