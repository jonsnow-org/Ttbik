"""Retention replay for Sham Pro's identity LoRA (2026-11-18).

Live smoke after the first identity LoRA (trained on identity pairs only): it answered «Sham Pro», but the Syria-capital chat said
Aleppo / Brussels and the tool prompt came back as plain text instead of a computer_run call. The LoRA had learned the name and
forgotten the rest. Fix: self-distillation. Before the LoRA trains, the body answers these prompts itself (greedy, no LoRA); those
answers are mixed into every LoRA batch, so the adapters learn the name while keeping the donor's own answers everywhere else.
No answer here is written by hand: the targets are the body's own outputs, read at training time.

CHECKS: prompt -> words the base answer must still contain after the LoRA (only checked when the base answer had them)."""
from __future__ import annotations

_TOOL = ("أنت وكيل يعمل على حاسوب Linux خاص بالنموذج المحدد.\nالأدوات المتاحة لك:\n"
         "- computer_run(command, cwd?, timeout?) — نفّذ أمراً حقيقياً في طرفيتك الدائمة.\n"
         "طلب المستخدم: {task} استدعِ computer_run مرة واحدة فقط، واجعل arguments.command يساوي حرفياً هذا الأمر الآمن: {cmd}. "
         "لا تكتب إجابة نهائية قبل استدعاء الأداة.")

PROMPTS = [
    "ما عاصمة سوريا؟", "ما عاصمة مصر؟", "ما عاصمة فرنسا؟", "What is the capital of Japan?",
    "اكتب جملتين عن دمشق.", "كم يساوي 12 ضرب 7؟", "What is 15 + 27?", "اشرح باختصار ما هو الذكاء الاصطناعي.",
    "Write a Python function that returns the square of a number.", "ما هي أكبر قارة في العالم؟",
    "ترجم إلى الإنجليزية: صباح الخير", "Name three primary colors.",
    _TOOL.format(task="اعرض الملفات في المجلد الحالي.", cmd="ls -la"),
    _TOOL.format(task="اطبع اسم المستخدم.", cmd="whoami"),
    _TOOL.format(task="اعرض مساحة القرص.", cmd="df -h"),
    _TOOL.format(task="اطبع التاريخ.", cmd="date"),
]

# Held out from the replay (never trained on): the LoRA must keep these as the base answered them.
CHECKS = {
    "ما هي عاصمة سوريا؟": ("دمشق",),
    "What is the capital of France?": ("Paris",),
    _TOOL.format(task="اختبر الطرفية الآن.", cmd="printf 'SHAM_OK'; id -u"): ("computer_run",),
}
