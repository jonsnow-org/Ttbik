import { finishNudge, madeChanges, worthALesson, toolNamesIn, execNudge, asksToRun, ranSomething, shouldRecoverBlockedAction, BLOCKED_REPLY_RECOVERIES, madeSuccessfulChanges } from "../coderFinishGate";

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
    expect(madeChanges(["github_create_branch", "github_create_pr", "github_run_workflow"])).toBe(false);
    expect(madeChanges(["sandbox_write_file"])).toBe(true);
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

describe("greetings are never action requests", () => {
  const { isChitChat, finishNudge } = require("@/lib/coderFinishGate");
  it("recognises a greeting / identity question and nothing that asks for work", () => {
    for (const t of ["كيف حالك من انت", "مرحبا", "من أنت؟", "who are you", "hello there"]) expect(isChitChat(t)).toBe(true);
    for (const t of ["أصلح الخطأ في المستودع", "كيف حالك؟ ثم أصلح ملف README وانشره", "حسّن الكود"]) expect(isChitChat(t)).toBe(false);
  });
  it("an earlier action request in the chat cannot reject a greeting's reply", () => {
    expect(finishNudge("كيف حالك من انت", [], "أنا نوفا، مساعد ذكي. كيف يمكنني مساعدتك اليوم؟", 0)).toBe("");
  });
});

describe("stale harness nudges", () => {
  const { dropStaleHarness } = require("@/lib/coderFinishGate");
  it("drops [harness] user messages that precede the last real user message; keeps the current run's own", () => {
    const msgs = [
      { role: "user", content: "أصلح الخطأ" },
      { role: "user", content: "[harness] The owner has already authorised you to ACT…" },
      { role: "assistant", content: "حاضر" },
      { role: "user", content: "كيف حالك من انت" },
      { role: "user", content: "[harness] now do the work" },
    ];
    const out = dropStaleHarness(msgs);
    expect(out.map((m: any) => m.content)).toEqual(["أصلح الخطأ", "حاضر", "كيف حالك من انت", "[harness] now do the work"]);
  });
  it("leaves a history without a real user message untouched", () => {
    const msgs = [{ role: "user", content: "[harness] x" }];
    expect(dropStaleHarness(msgs)).toEqual(msgs);
  });
});

describe("questions are never action requests, and no rejection notice is ever sent to the chat", () => {
  const { isQuestionLike, finishNudge } = require("@/lib/coderFinishGate");
  it("recognises a question and nothing that asks for work", () => {
    for (const t of ["لماذا", "لماذا؟", "كيف ذلك", "هل تستطيع؟", "why", "what happened"]) expect(isQuestionLike(t)).toBe(true);
    for (const t of ["أصلح الخطأ في المستودع", "كيف حالك؟ ثم أصلح ملف README وانشره", "حسّن الكود", "البوت هو @Slaselbot"]) expect(isQuestionLike(t)).toBe(false);
  });
  it("a question's own reply is not rejected, even right after an action request", () => {
    expect(finishNudge("لماذا", [], "لأني لم أتمكن من الوصول إلى الأدوات اللازمة لتنفيذ المهمة.", 0)).toBe("");
  });
  it("the chat never receives the «الرد السابق لا يُعتمد» notice", () => {
    const src = require("fs").readFileSync(require.resolve("../coderSections.ts"), "utf8");
    expect(src).not.toContain("الرد السابق لا يُعتمد");
  });
});


describe("recovery after a blocked repeated action reply", () => {
  test("replans a read-only failed action twice, then stops retrying", () => {
    expect(shouldRecoverBlockedAction(GOAL, ["github_repo_scan", "computer_search"], 0)).toBe(true);
    expect(shouldRecoverBlockedAction(GOAL, ["github_repo_scan", "computer_search"], 1)).toBe(true);
    expect(shouldRecoverBlockedAction(GOAL, ["github_repo_scan", "computer_search"], BLOCKED_REPLY_RECOVERIES)).toBe(false);
  });
  test("does not recover after a real change or for a question", () => {
    expect(shouldRecoverBlockedAction(GOAL, ["computer_edit"], 0)).toBe(false);
    expect(shouldRecoverBlockedAction("ما أفضل لغة برمجة؟", [], 0)).toBe(false);
  });
});


describe("verified changes require a successful matching tool result", () => {
  const editCall = { id: "edit-1", type: "function" as const, function: { name: "computer_edit", arguments: "{}" } };
  test("failed or denied write attempts do not count as changes", () => {
    expect(madeSuccessfulChanges([
      { role: "assistant", tool_calls: [editCall] },
      { role: "tool", tool_call_id: "edit-1", content: "error: file not found" },
    ])).toBe(false);
    expect(madeSuccessfulChanges([
      { role: "assistant", tool_calls: [editCall] },
      { role: "tool", tool_call_id: "edit-1", content: "result: File not found" },
    ])).toBe(false);
    expect(madeSuccessfulChanges([
      { role: "assistant", tool_calls: [editCall] },
      { role: "tool", tool_call_id: "edit-1", content: "Already up to date; no changes to commit" },
    ])).toBe(false);
    expect(madeSuccessfulChanges([
      { role: "assistant", tool_calls: [editCall] },
      { role: "tool", tool_call_id: "edit-1", content: "DENIED by the user's standing policy" },
    ])).toBe(false);
    expect(madeSuccessfulChanges([
      { role: "assistant", tool_calls: [editCall] },
      { role: "tool", tool_call_id: "edit-1", content: "{\"ok\":false,\"error\":\"permission denied\"}" },
    ])).toBe(false);
    expect(madeSuccessfulChanges([
      { role: "assistant", tool_calls: [editCall] },
      { role: "tool", tool_call_id: "edit-1", content: "step 1: wrote file\nstep 2: error: disk full" },
    ])).toBe(false);
    expect(madeSuccessfulChanges([{ role: "assistant", tool_calls: [editCall] }])).toBe(false);
  });

  test("a successful matching write result counts, and an unrelated result does not", () => {
    expect(madeSuccessfulChanges([
      { role: "assistant", tool_calls: [editCall] },
      { role: "tool", tool_call_id: "other-call", content: "file updated" },
    ])).toBe(false);
    const messages = [
      { role: "assistant", tool_calls: [editCall] },
      { role: "tool", tool_call_id: "edit-1", content: "Edited src/app.ts successfully" },
    ];
    expect(madeSuccessfulChanges(messages)).toBe(true);
    expect(shouldRecoverBlockedAction(GOAL, ["computer_edit"], 0, messages)).toBe(false);
    expect(worthALesson(GOAL, ["computer_edit"], messages)).toBe(true);
  });


  test("sandbox writes count, but read-only computer batches and PR creation do not", () => {
    const sandbox = { id: "sbx-1", type: "function" as const, function: { name: "sandbox_write_file", arguments: "{}" } };
    expect(madeSuccessfulChanges([
      { role: "assistant", tool_calls: [sandbox] },
      { role: "tool", tool_call_id: "sbx-1", content: "wrote /tmp/task.txt" },
    ])).toBe(true);

    const batch = { id: "batch-1", type: "function" as const, function: { name: "computer_batch", arguments: JSON.stringify({ steps: [{ tool: "computer_read", path: "README.md" }] }) } };
    expect(madeSuccessfulChanges([
      { role: "assistant", tool_calls: [batch] },
      { role: "tool", tool_call_id: "batch-1", content: "read README.md" },
    ])).toBe(false);

    const pr = { id: "pr-1", type: "function" as const, function: { name: "github_create_pr", arguments: "{}" } };
    expect(madeSuccessfulChanges([
      { role: "assistant", tool_calls: [pr] },
      { role: "tool", tool_call_id: "pr-1", content: "Created pull request #12" },
    ])).toBe(false);
  });

  test("a false claim after a failed write is sent back for real work", () => {
    const messages = [
      { role: "assistant", tool_calls: [editCall] },
      { role: "tool", tool_call_id: "edit-1", content: "error: permission denied" },
    ];
    expect(finishNudge(GOAL, ["computer_edit"], "تم إصلاح المشكلة", 0, messages)).toMatch(/nothing was changed/i);
  });
});
