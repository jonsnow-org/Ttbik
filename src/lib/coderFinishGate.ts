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

/** A greeting or a question about the model itself: never an action request, whatever the owner asked earlier in the chat. */
const CHITCHAT = /^[\s\p{P}]*(?:(?:مرحبا|مرحباً|هلا|اهلا|أهلا|أهلاً|السلام عليكم|صباح الخير|مساء الخير|hi|hello|hey)(?!\p{L})[\s\S]{0,40}|[\s\S]{0,30}(?:كيف حالك|كيفك|شلونك|من انت|من أنت|ما اسمك|ما هو اسمك|who are you|how are you|what is your name)[\s\S]{0,30})[\s\p{P}]*$/iu;
export function isChitChat(text: string): boolean {
  const t = String(text || "").trim();
  return t.length > 0 && t.length <= 80 && CHITCHAT.test(t) && !isActionGoal(t);
}

/** A question («لماذا؟», «كيف ذلك», «why», «هل …؟»): it asks for an answer, never for work, whatever was asked earlier in the chat. */
const QUESTION = /^[\s\p{P}]*(?:لماذا|ليش|لِم|كيف|ماذا|ما\s|ما$|من\s|متى|أين|اين|هل\s|كم\s|أي\s|اي\s|why|how|what|who|when|where|which|is\s|are\s|do\s|does\s|can\s)/iu;
export function isQuestionLike(text: string): boolean {
  const t = String(text || "").trim();
  return t.length > 0 && t.length <= 160 && (/[?؟]\s*$/.test(t) || QUESTION.test(t)) && !isActionGoal(t);
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

/**
 * Execution gate (live task suite 2026-11-21, Nova `code-run`): «اكتب برنامج بايثون يطبع مربعات الأعداد ونفّذه على حاسوبك وأخبرني بالناتج» got a reply that showed the code
 * and a made-up result with ZERO tool calls. When the request itself says to RUN something on the computer and the run made no execution call, the answer is sent back to
 * work (at most twice). It applies to every user: running code in the isolated computer is what they asked for, not an owner-only authorisation.
 */
const EXEC_VERB = /(نفّ?ذ(?:ه|ها|وه|ي)?|نفذ(?:ه|ها)?|شغّ?ل(?:ه|ها)?|run it|execute|run the (?:code|program|script)|run (?:it )?on)/i;
const EXEC_PLACE = /(حاسوب|جهاز|computer|terminal|sandbox|الطرفية)/i;
const EXEC_TOOL = /^(computer_(run|test|batch|job)|sandbox_exec|browser|desktop)$/;

export function asksToRun(goal: string): boolean {
  const t = String(goal || "");
  return EXEC_VERB.test(t) && EXEC_PLACE.test(t);
}

export function ranSomething(toolNames: string[]): boolean {
  return toolNames.some((n) => EXEC_TOOL.test(n));
}

/** The harness message for a run whose request said to run something but made no execution call, else "". */
export function execNudge(goal: string, toolNames: string[], text: string, nudges: number): string {
  if (nudges >= 2 || !asksToRun(goal) || ranSomething(toolNames)) return "";
  if (String(text || "").trim().length < 10) return "";
  return "[harness] The user asked you to RUN this on the computer, but you answered without running anything: no computer_run call was made, so any output you wrote is not real. "
    + "Write the program with computer_write if you have not, then call computer_run on it now, and answer ONLY from its real printed output. Reply in the user's language.";
}

/**
 * The harness' own nudges («[harness] … ACT on this request …», «… the task was stopped here») belong to the run that made them. Left in the history they were read by the NEXT
 * message as if the user had said them: «كيف حالك من انت» was answered in English, seven minutes later, with «I couldn't complete the task because the harness stopped me … clone the
 * repository» (live 2026-11-22). Every [harness] user message that comes BEFORE the last real user message is dropped from what the model sees; the current run's own stay.
 */
export function dropStaleHarness<T extends { role: string; content?: unknown }>(msgs: T[]): T[] {
  const isHarness = (m: T) => m.role === "user" && String(m.content || "").startsWith("[harness]");
  let lastReal = -1;
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === "user" && !isHarness(msgs[i])) { lastReal = i; break; }
  return lastReal < 0 ? msgs : msgs.filter((m, i) => !(i < lastReal && isHarness(m)));
}
