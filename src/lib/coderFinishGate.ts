/**
 * Finish gate (owner order 2026-11-15, after the live Cerator00bot task): the owner asked Nova to "fix and develop the bot fully";
 * Nova read the code for 30 minutes, then ended with "which step do you want me to start with?" and changed nothing, and the run was
 * stored as a training lesson. For the OWNER an action request is already an authorisation: a final answer that made no change is sent back
 * to work (at most twice), and a run that made no change is never stored as a lesson.
 */
const ACTION_GOAL = /(أصلح|اصلح|إصلاح|اصلاح|صحّح|صحح|طوّر|طور|تطوير|عدّل|عدل |نفّذ|نفذ|ادمج|ادفع|انشر|أنشئ|أضف|حسّن|حسن |fix\b|implement|develop|improve|refactor|merge|publish|deploy|build\b)/i;
const CHANGE_TOOL = /^(computer_(write|edit|patch|publish|batch)|sandbox_(write_file|edit_file|push)|github_(create_branch|create_pr|edit_file|write_files|merge_pr|delete_files|update_ref|run_workflow|comment|create_issue|update_repo))$/;
const CODE_CHANGE_TOOL = /^(computer_(write|edit|patch|publish)|sandbox_(write_file|edit_file|push)|github_(edit_file|write_files|merge_pr|delete_files|update_ref))$/;

export function toolNamesIn(messages: Array<{ tool_calls?: Array<{ function?: { name?: string } }> }>): string[] {
  const out: string[] = [];
  for (const m of messages || []) for (const c of m.tool_calls || []) if (c?.function?.name) out.push(c.function.name);
  return out;
}

export function madeChanges(toolNames: string[]): boolean {
  return toolNames.some((n) => CHANGE_TOOL.test(n));
}

type GateMessage = {
  role?: string;
  content?: unknown;
  tool_call_id?: string;
  tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
};
function toolOutputFailed(output: string): boolean {
  const t = String(output || "").trim().replace(/^(?:result|output)\s*:\s*/i, "");
  if (!t || /\b(?:NOT EXECUTED|NOT CHANGED|NO CHANGE|NO CHANGES|NOTHING TO COMMIT|ALREADY UP TO DATE|AUTO_DENIED|NOT PERMITTED|DENIED)\b/i.test(t)) return true;
  try {
    const parsed = JSON.parse(t);
    if (parsed && typeof parsed === "object" && (parsed.ok === false || parsed.success === false || Boolean(parsed.error) || (Array.isArray(parsed.errors) ? parsed.errors.length > 0 : Boolean(parsed.errors)) || (typeof parsed.status === "number" && parsed.status >= 400))) return true;
  } catch { /* tools may return plain text or a multi-line batch report */ }
  return /^(?:file|path|directory|repository|branch|resource)\s+(?:not found|was not found|does not exist)\b|(?:^|[\n;:]\s*)(?:error\b|failed(?:\s+to)?\b|failure\b|HTTP [45]\d{2}\b|permission denied\b|unauthorized\b|forbidden\b|not found\b|no such file\b|could not\b|cannot\b|timed? out\b)/i.test(t);
}

/** A tool call is progress only when its matching tool result confirms success. The result's `name` is authoritative because some Studio adapters omit the assistant call from the persisted transcript. */
function madeSuccessfulToolAction(messages: GateMessage[], allowed: RegExp): boolean {
  for (const result of messages || []) {
    if (result.role !== "tool" || !result.tool_call_id) continue;
    let callName = "";
    let callArgs = "";
    for (const message of messages || []) {
      const call = (message.tool_calls || []).find((item) => item.id === result.tool_call_id);
      if (call) { callName = String(call.function?.name || ""); callArgs = String(call.function?.arguments || ""); break; }
    }
    const name = String((result as GateMessage & { name?: string }).name || callName);
    if (!allowed.test(name)) continue;
    if (name === "computer_batch") {
      let args: { steps?: Array<{ tool?: string }> } | undefined;
      try { args = JSON.parse(callArgs || "{}"); } catch { args = undefined; }
      if (!args?.steps?.some((step) => allowed.test(String(step?.tool || "")))) continue;
    }
    if (!toolOutputFailed(String(result.content || ""))) return true;
  }
  return false;
}

/** Successful side effect (branch/PR/comment or code write); useful for deciding whether the run made a concrete step. */
export function madeSuccessfulActions(messages: GateMessage[]): boolean {
  return madeSuccessfulToolAction(messages, CHANGE_TOOL);
}

/** Successful source/data change; required before claiming a fix or storing an owner run as a training lesson. */
export function madeSuccessfulChanges(messages: GateMessage[]): boolean {
  return madeSuccessfulToolAction(messages, CODE_CHANGE_TOOL);
}

const CLAIM = /(تم\s+(?:إصلاح|اصلاح|تنفيذ|تطوير|تحسين|تعديل|إضافة|اضافة|كتابة|دمج|نشر)|تم\s+(?:إنشاء|انشاء)\s+(?:ملف|كود|مجلد|script|file|module)|قمت\s+ب(?:إصلاح|اصلاح|تعديل|تطوير|إضافة|اضافة|تحسين)|تحسينات\s+في\s+\S+\.(?:py|ts|tsx|js|json)|I(?:'ve| have)\s+(?:fixed|implemented|updated|added|improved|refactored))/i;

/** True when the answer reports that something was changed. */
export function claimsChanges(text: string): boolean {
  return CLAIM.test(String(text || ""));
}

export function isActionGoal(goal: string): boolean {
  return ACTION_GOAL.test(String(goal || ""));
}

/**
 * An instruction that asks for words, not for work («قل…», «أجب…», «اشرح…», "say" / "explain"). Live 2026-11-26: the owner's
 * «اختبار ثالث بعد إصلاح حرس الرد المكرر: قل في سطر واحد أنك بخير» matched ACTION_GOAL on the word «إصلاح», so Nova's correct
 * one-line answer was sent back to work, the re-run failed, and the chat ended with an error instead of the reply.
 */
const SAY_GOAL = /(?:^|[\s:،؛.!])(?:قل|قُل|أجب|اجب|اكتب لي|اكتبلي|أخبرني|اخبرني|اشرح|وضّح|لخّص|ترجم|ردّ علي|رد علي|أعطني(?: لي)? سطر|say\b|answer\b|explain\b|tell me\b|describe\b|summari[sz]e\b|translate\b|reply with\b)/i;
export function isSayGoal(goal: string): boolean {
  return SAY_GOAL.test(String(goal || ""));
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
export function finishNudge(goal: string, toolNames: string[], text: string, nudges: number, messages?: GateMessage[]): string {
  const acted = messages ? madeSuccessfulActions(messages) : madeChanges(toolNames);
  const codeChanged = messages ? madeSuccessfulChanges(messages) : toolNames.some((n) => CODE_CHANGE_TOOL.test(n));
  if (nudges >= 3) return "";
  if (isSayGoal(goal)) return "";                                    // «قل…»/«اشرح…» asks for an answer, never for a file change
  // A branch/PR is a real step, but it is not proof that the code was fixed.
  if (claimsChanges(text) && !codeChanged) {
    return "[harness] Your answer says things were fixed or changed, but this run made NO edit, write, patch or publish call: nothing was changed. Never report work you did not do. "
      + "Do the work now (computer_read the file, computer_edit it, computer_test, computer_publish), or say plainly that nothing was changed yet and why. Write in the owner's language (Arabic).";
  }
  if (!isActionGoal(goal) || acted) return "";
  if (String(text || "").trim().length < 20) return "";
  return "[harness] The owner has already authorised you to ACT on this request and does not want a menu of options or a report. Do not ask which step to start with. "
    + "Now: bring the repository to the computer (computer_repo), find the exact bug or missing feature, edit the files (computer_edit / computer_write), run the tests (computer_test / computer_run), "
    + "and publish the change with computer_publish as a branch and pull request. The request is broad, so do NOT try to finish everything: take the FIRST concrete item of your own list, make that one change now with computer_edit (read the file with computer_read first), run its test, then publish it; further items can follow in later steps. Report only after something was really changed and verified. Write in the language of the owner's request (Arabic) and make the tool call in THIS step, through the tool interface, never as <tool_call> text. If the repository holds several candidates, choose the one that matches the owner's own words (search the code for them).";
}

/**
 * The line for an owner action run that is ending because the model kept repeating the same sentence and never called a tool.
 * Live 2026-11-24: after the owner named the repository, Nova answered «سأبدأ الآن …» again and again; the reply guard blocked the
 * copy and the chat received the engine's own «تعذّر تكوين جواب مناسب لهذه الرسالة» three times, then the task ended silently.
 * That placeholder describes the engine, not the task: the honest line says nothing was changed and how to go on.
 */
export function stalledActionNote(goal: string, toolNames: string[], messages?: GateMessage[]): string {
  const acted = messages ? madeSuccessfulActions(messages) : madeChanges(toolNames);
  if (!isActionGoal(goal) || isSayGoal(goal) || acted) return "";
  return "⏹️ توقفت قبل تنفيذ أي خطوة: النموذج أعاد نفس الجملة ولم يستدعِ أي أداة، فلم يُغيَّر أي ملف. "
    + "اكتب «تابع» وسأكمل من أول خطوة فعلية: البحث داخل المستودع عن الاسم الذي ذكرته ثم قراءة الملفات التي يجدها.";
}

/** A repeated-reply guard must trigger a recovery plan before it gives up on an authorised action. */
export const BLOCKED_REPLY_RECOVERIES = 2;
export function shouldRecoverBlockedAction(goal: string, toolNames: string[], recoveries: number, messages?: GateMessage[]): boolean {
  const acted = messages ? madeSuccessfulActions(messages) : madeChanges(toolNames);
  return recoveries < BLOCKED_REPLY_RECOVERIES && isActionGoal(goal) && !isSayGoal(goal) && !acted;
}

/** A run is a lesson for training only when it did what was asked: an action request that changed nothing is not stored. */
export function worthALesson(goal: string, toolNames: string[], messages?: GateMessage[]): boolean {
  const changed = messages ? madeSuccessfulChanges(messages) : toolNames.some((n) => CODE_CHANGE_TOOL.test(n));
  return !isActionGoal(goal) || changed;
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
