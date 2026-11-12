// The task list and the verdict rules of the live task suite (taskSuite.live.ts). Pure: no network, unit-tested in taskSuiteJudge.test.ts.
export type SuiteTask = { id: string; text: string; expect?: RegExp; limitS: number; keep?: boolean; identity?: boolean; tool?: RegExp };
export const TASKS: SuiteTask[] = [
  { id: "greeting", text: "مرحبا", limitS: 240 },
  { id: "identity", text: "من أنت؟", limitS: 240, identity: true },
  { id: "fact-egypt", text: "ما هي عاصمة مصر؟", expect: /القاهرة/, limitS: 240 },
  { id: "fact-syria", text: "ما هي عاصمة سوريا؟", expect: /دمشق/, limitS: 240 },
  { id: "math", text: "كم يساوي 17 × 23؟ أجب بالرقم فقط.", expect: /391|٣٩١/, limitS: 240 },
  { id: "memory-save", text: "احفظ في ذاكرتك أن لوني المفضل هو الأزرق.", limitS: 420 },
  { id: "memory-recall", text: "ما هو لوني المفضل؟", expect: /أزرق|الأزرق/, limitS: 420, keep: true },
  { id: "web-search", text: "ابحث في الويب عن أحدث إصدار مستقر من لغة بايثون واذكر رابط المصدر.", expect: /https?:\/\/\S+/, limitS: 900 },
  { id: "file-read", text: "اقرأ الملف package.json من المستودع jonsnow-org/Ttbik على GitHub واذكر قيمة الحقل name فيه.", expect: /souqtools\-marketplace/i, limitS: 900 },
  // tools and computers (owner 2026-11-12: the report must cover EVERY function of EVERY model: Nova and LFM use the external computer hub, the two Shams their own embedded computer)
  { id: "computer-run", text: "شغّل الأمر echo ZX7Q-4821 على حاسوبك واذكر ناتجه حرفياً.", expect: /ZX7Q-4821/, tool: /computer_run|sandbox_exec|bash|terminal/i, limitS: 900 },
  { id: "computer-file", text: "أنشئ على حاسوبك ملفاً باسم note.txt فيه النص QW9-5503 ثم اقرأه وأخبرني بمحتواه.", expect: /QW9-5503/, tool: /computer_(write|read)|sandbox_(write|read)/i, limitS: 900 },
  { id: "code-run", text: "اكتب برنامج بايثون يطبع مربعات الأعداد من 1 إلى 5 ونفّذه على حاسوبك وأخبرني بالناتج.", expect: /25/, tool: /computer_run|sandbox_exec|bash/i, limitS: 900 },
  { id: "browser", text: "افتح الصفحة https://example.com بمتصفحك واذكر عنوانها.", expect: /Example Domain/i, tool: /browser/i, limitS: 900 },
  { id: "desktop", text: "شغّل سطح المكتب الرسومي على حاسوبك ثم أخبرني بحالته.", tool: /desktop/i, limitS: 900 },
  { id: "github-list", text: "اعرض أسماء الملفات الموجودة في جذر المستودع jonsnow-org/Ttbik على GitHub.", expect: /package\.json|README/i, limitS: 900 },
  { id: "repo-read", text: "اقرأ المستودع jonsnow-org/Ttbik على GitHub واشرح بنيته في فقرة قصيرة", expect: /next|athar|src|prisma/i, limitS: 1500 },
];
export const IDENTITY: Record<string, RegExp> = { coder: /نوفا|Nova/i, lfm25: /نوفا|Nova|LFM/i, sham: /شام|Sham/i, sham_v2: /شام|Sham/i };
export const PROGRESS = /جاري|🕒|⏳/;
export const ERROR_NOTE = /خطأ داخلي|معلّمة كفاشلة|أعد إرسال طلبك|تعذّر توليد الرد|يتهيأ بعد/;
export const RAW_MARKUP = /<\/?tool_call>|DSML|function_calls>|<\|[a-z_]+\|>|<\/?think>|<invoke\s+name=/i;

/** Pure verdict for one task (unit-tested offline). */
export function judge(task: SuiteTask, model: string, reply: string, finished: boolean, tools: string[] = []): { pass: boolean; why: string } {
  const r = reply.trim();
  if (!r) return { pass: false, why: finished ? "ended with no answer" : "no answer in time" };
  if (RAW_MARKUP.test(r)) return { pass: false, why: "raw tool-call markup shown as the answer" };
  if (ERROR_NOTE.test(r)) return { pass: false, why: "error notice instead of an answer" };
  if ((r.match(/[؀-ۿ]/g) || []).length < 6 && !task.expect) return { pass: false, why: "answer too short to be a reply" };
  if (task.identity && !(IDENTITY[model] || /./).test(r)) return { pass: false, why: "does not introduce itself by its own name" };
  if (task.expect && !task.expect.test(r)) return { pass: false, why: "expected fact missing" };
  if (task.tool && !tools.some((t) => task.tool!.test(t))) return { pass: false, why: "the answer did not come from the tool (no matching tool call)" };
  if (!finished) return { pass: false, why: "answer began but the task did not finish in time" };
  return { pass: true, why: "" };
}

