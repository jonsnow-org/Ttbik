/**
 * Finish gate (owner order 2026-11-15, after the live Cerator00bot task): the owner asked Nova to "fix and develop the bot fully";
 * Nova read the code for 30 minutes, then ended with "which step do you want me to start with?" and changed nothing, and the run was
 * stored as a training lesson. For the OWNER an action request is already an authorisation: a final answer that made no change is sent back
 * to work (at most twice), and a run that made no change is never stored as a lesson.
 */
const ACTION_GOAL = /(أصلح|اصلح|إصلاح|اصلاح|صحّح|صحح|طوّر|طور|تطوير|عدّل|عدل |نفّذ|نفذ|ادمج|ادفع|انشر|أنشئ|أضف|حسّن|حسن |fix\b|implement|develop|improve|refactor|merge|publish|deploy|build\b)/i;
const CHANGE_TOOL = /^(computer_(write|edit|patch|publish|batch)|github_(create_branch|create_pr|edit_file|write_files|merge_pr|delete_files|update_ref|run_workflow|comment|create_issue|update_repo))$/;

export function toolNamesIn(messages: Array<{ tool_calls?: Array<{ function?: { name?: string } }> }>): string[] {
  const out: string[] = [];
  for (const m of messages || []) for (const c of m.tool_calls || []) if (c?.function?.name) out.push(c.function.name);
  return out;
}

export function madeChanges(toolNames: string[]): boolean {
  return toolNames.some((n) => CHANGE_TOOL.test(n));
}

const CLAIM = /(تم\s+(?:إصلاح|اصلاح|تنفيذ|تطوير|تحسين|تعديل|إضافة|اضافة|إنشاء|انشاء|نشر|دمج|كتابة)|قمت\s+ب(?:إصلاح|اصلاح|تعديل|تطوير|إضافة|اضافة|تحسين)|تحسينات\s+في\s+\S+\.(?:py|ts|tsx|js|json)|I(?:'ve| have)\s+(?:fixed|implemented|updated|added|improved|refactored))/i;

/** True when the answer reports that something was changed. */
export function claimsChanges(text: string): boolean {
  return CLAIM.test(String(text || ""));
}

export function isActionGoal(goal: string): boolean {
  return ACTION_GOAL.test(String(goal || ""));
}

/** The harness message that sends an owner's run back to work, or "" when the run may end (no action asked, something was changed, or already nudged twice). */
export function finishNudge(goal: string, toolNames: string[], text: string, nudges: number): string {
  if (nudges >= 3) return "";
  // An answer that says "تم إصلاح / تم تنفيذ …" while no edit, write or publish call was ever made is a false report (live 2026-11-16: five files "improved", zero change calls).
  if (claimsChanges(text) && !madeChanges(toolNames)) {
    return "[harness] Your answer says things were fixed or changed, but this run made NO edit, write, patch or publish call: nothing was changed. Never report work you did not do. "
      + "Do the work now (computer_read the file, computer_edit it, computer_test, computer_publish), or say plainly that nothing was changed yet and why. Write in the owner's language (Arabic).";
  }
  if (!isActionGoal(goal) || madeChanges(toolNames)) return "";
  if (String(text || "").trim().length < 20) return "";
  return "[harness] The owner has already authorised you to ACT on this request and does not want a menu of options or a report. Do not ask which step to start with. "
    + "Now: bring the repository to the computer (computer_repo), find the exact bug or missing feature, edit the files (computer_edit / computer_write), run the tests (computer_test / computer_run), "
    + "and publish the change with computer_publish as a branch and pull request. The request is broad, so do NOT try to finish everything: take the FIRST concrete item of your own list, make that one change now with computer_edit (read the file with computer_read first), run its test, then publish it; further items can follow in later steps. Report only after something was really changed and verified. Write in the language of the owner's request (Arabic) and make the tool call in THIS step, through the tool interface, never as <tool_call> text. If the repository holds several candidates, choose the one that matches the owner's own words (search the code for them).";
}

/** A run is a lesson for training only when it did what was asked: an action request that changed nothing is not stored. */
export function worthALesson(goal: string, toolNames: string[]): boolean {
  return !isActionGoal(goal) || madeChanges(toolNames);
}
