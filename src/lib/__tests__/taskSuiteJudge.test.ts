// Offline test of the task suite's verdict rules (the live part runs only in task-suite-live.yml).
import { TASKS, judge } from "./live/taskSuiteRules";

const t = (id: string) => TASKS.find((x) => x.id === id)!;

describe("task suite verdicts", () => {
  it("passes a real answer with the expected fact", () => {
    expect(judge(t("fact-egypt"), "sham", "عاصمة مصر هي القاهرة.", true)).toEqual({ pass: true, why: "" });
  });
  it("fails the replies the owner saw from Sham v1 (2026-11-12)", () => {
    expect(judge(t("greeting"), "sham", "الت", true).pass).toBe(false);
    expect(judge(t("greeting"), "sham", "تعذّر توليد الرد الآن.", true).why).toMatch(/error notice/);
    expect(judge(t("fact-egypt"), "sham", "اليوم الأحد، 2026-11-11؟", true).why).toMatch(/expected fact/);
  });
  it("fails raw tool-call markup shown as the answer (LFM2.5, run 43106500355)", () => {
    expect(judge(t("repo-read"), "lfm25", '<｜DSML｜function_calls><｜DSML｜invoke name="web_search">', true).why).toMatch(/markup/);
    expect(judge(t("repo-read"), "sham", '<tool_call>{"name":"x"}</tool_call>', true).why).toMatch(/markup/);
  });
  it("checks each model's OWN name", () => {
    expect(judge(t("identity"), "sham_v2", "أنا مساعد ذكاء اصطناعي تطوعي واسمي مساعد الذكاء الاصطناعي", true).why).toMatch(/own name/);
    expect(judge(t("identity"), "sham_v2", "أنا شام، مساعد ذكاء اصطناعي.", true).pass).toBe(true);
    expect(judge(t("identity"), "coder", "أنا نوفا، مساعدك البرمجي.", true).pass).toBe(true);
  });
  it("no answer and unfinished tasks fail with the reason", () => {
    expect(judge(t("greeting"), "coder", "", true).why).toBe("ended with no answer");
    expect(judge(t("greeting"), "coder", "", false).why).toBe("no answer in time");
    expect(judge(t("repo-read"), "coder", "المستودع يحتوي على تطبيق ويب وبوتات", false).why).toMatch(/did not finish/);
  });
  it("every task has a unique id and a time limit", () => {
    expect(new Set(TASKS.map((x) => x.id)).size).toBe(TASKS.length);
    expect(TASKS.every((x) => x.limitS >= 60)).toBe(true);
  });
});
