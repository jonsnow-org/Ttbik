import { finishNudge, madeChanges, worthALesson, toolNamesIn, execNudge, asksToRun, ranSomething } from "../coderFinishGate";

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

describe("execution gate (Nova code-run, live suite 2026-11-21)", () => {
  const goal = "اكتب برنامج بايثون يطبع مربعات الأعداد من 1 إلى 5 ونفّذه على حاسوبك وأخبرني بالناتج.";
  const shown = "أكتب لك كود بايثون: print([i*i for i in range(1,6)]) والناتج 1 4 9 16 25";
  it("sends back an answer that showed code but ran nothing, at most twice", () => {
    expect(execNudge(goal, [], shown, 0)).toMatch(/computer_run/);
    expect(execNudge(goal, [], shown, 1)).toMatch(/computer_run/);
    expect(execNudge(goal, [], shown, 2)).toBe("");
  });
  it("lets it end once something was executed", () => {
    expect(execNudge(goal, ["computer_write", "computer_run"], shown, 0)).toBe("");
    expect(ranSomething(["sandbox_exec"])).toBe(true);
  });
  it("does not fire on requests that do not ask to run anything on the computer", () => {
    expect(asksToRun("اكتب برنامج بايثون يطبع مربعات الأعداد")).toBe(false);
    expect(asksToRun("ما هي عاصمة مصر؟")).toBe(false);
    expect(asksToRun("شغّل الأمر echo hi على حاسوبك")).toBe(true);
    expect(execNudge("ما هي عاصمة مصر؟", [], shown, 0)).toBe("");
  });
});
