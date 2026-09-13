"""
Owner report, 2026-09-13 ("لاحظت انك كل عملك هو اعطاء اوامر لنوفا وليس
جعله هو يعرف ويفكر ويقرأ وينفذ ويتعلم ويخطط كما انت تفعل الآن حين تقوم
بعملك هذا كله معي — لماذا هو لايملك ذات القدرة والمعرفة"): a completely
fair, precise diagnosis. Every real fix this session (assess_feasibility
reading the repo tree, propose_code_change reading a file before editing
it, etc.) was ME deciding what Nova needed to look at and hard-coding
that lookup into a fixed Python function — Nova itself never decided to
go look at anything. That is not the same thing as what I actually do in
this conversation: read something real, think about what it means,
decide what to check next based on what I just saw, and keep going until
the task is actually done.

This module is the real, first version of that — not a promise, a
working loop:

  1. The model is given a task and a small set of REAL tools (not
     prose describing tools — actual Python callables it can invoke),
     each returning REAL data (an actual file's content, an actual
     directory listing) rather than whatever it already believes.
  2. Each turn, the model sees the FULL real transcript so far (every
     tool call it made and every real result it got back) and decides
     the next action itself — call another tool, or finish with a real
     answer. This is what "يفكر ويقرأ وينفذ ويخطط" actually means in
     code: a loop that keeps going based on real observations, not one
     fixed function that runs the same steps every time regardless of
     what's actually true about this specific task.
  3. Bounded on two independent axes, so a model that never says
     "finish" can never hang this forever: MAX_STEPS caps total tool
     calls, and each individual model call still goes through
     with_hard_deadline exactly like every other model call in this
     project — the same real fix for the same real hanging-forever
     class of bug already found and fixed elsewhere today.
  4. A tool that raises is never allowed to crash the loop — its error
     becomes a real observation fed back to the model (so it can react
     — try a different path, ask for something else), the same
     "a failure here must never look like success" principle this
     project already applies to every background task.

This is intentionally NOT a generic multi-domain framework yet — it is
wired into exactly one real, concrete use first (assess_feasibility, see
that function's own docstring for how it now uses this), on purpose:
proving the loop actually works for one real task before generalizing
it, rather than building an untested abstraction for every future use
at once.
"""
import json
import logging
import re
from dataclasses import dataclass
from typing import Callable

from app.concurrency import with_hard_deadline

logger = logging.getLogger("nova")

# A model that never calls finish (or a genuinely stuck task) must
# still end — this is the SAME real principle as every other bounded
# loop in this project (with_hard_deadline, _run_bounded): an honest
# "I could not finish" beats silence or an unbounded loop.
_DEFAULT_MAX_STEPS = 6
_DEFAULT_STEP_TIMEOUT = 100.0


@dataclass
class Tool:
    name: str
    description: str
    # Takes the parsed "args" dict from the model's tool call, returns
    # a string observation. May raise — the loop catches it.
    run: Callable[[dict], str]


@dataclass
class AgentResult:
    answer: str
    steps_used: int
    transcript: list[str]
    finished: bool  # False means max_steps was hit without a real finish() call


def _parse_tool_call(raw: str) -> dict:
    match = re.search(r"\{.*\}", raw, re.DOTALL) if raw else None
    if not match:
        return {}
    try:
        return json.loads(match.group(0))
    except Exception:
        return {}


def _tools_block(tools: list[Tool]) -> str:
    lines = [f'- {t.name}: {t.description}' for t in tools]
    return "\n".join(lines)


def run_agent_loop(
    task_prompt: str,
    tools: list[Tool],
    call_model: Callable[[str], str | None],
    *,
    max_steps: int = _DEFAULT_MAX_STEPS,
    step_timeout: float = _DEFAULT_STEP_TIMEOUT,
) -> AgentResult:
    """The real loop. `call_model` is a plain str->str|None function
    (already bound to whatever query_type/context a caller needs,
    e.g. a lambda wrapping council.call_modelscope_specialist) so this
    module stays free of any dependency on council.py's own call
    shape — callers decide which model/fallback chain to use, this
    only drives the loop around it.

    Every real tool call and its real result is appended to the
    transcript and included verbatim in the next model call — this is
    what makes each step a genuine decision based on what actually
    happened, not a blind re-guess."""
    tools_by_name = {t.name: t for t in tools}
    transcript: list[str] = []

    system_block = (
        "أنت تعمل ضمن حلقة تفكير حقيقية خطوة بخطوة. لديك أدوات حقيقية يمكنك استدعاؤها لمعرفة "
        "حقائق فعلية قبل أن تقرر — لا تخمّن ما تستطيع التحقق منه فعلاً. في كل خطوة، أجب حصراً "
        "بصيغة JSON صحيحة بدون أي نص إضافي، بأحد شكلين:\n"
        '{"tool": "اسم الأداة", "args": {...}} لاستدعاء أداة، أو\n'
        '{"finish": "إجابتك النهائية الكاملة هنا"} عندما تصل لقرار نهائي واثق.\n\n'
        f"الأدوات المتاحة:\n{_tools_block(tools)}\n\n"
        f"المهمة:\n{task_prompt}"
    )

    for step in range(1, max_steps + 1):
        prompt = system_block + ("\n\nسجل الخطوات حتى الآن:\n" + "\n".join(transcript) if transcript else "")
        raw = with_hard_deadline(call_model, prompt, timeout=step_timeout)
        if raw is None:
            transcript.append(f"[خطوة {step}] النموذج لم يرد في الوقت المحدد.")
            continue

        parsed = _parse_tool_call(raw)
        if "finish" in parsed:
            answer = str(parsed["finish"]).strip()
            if answer:
                return AgentResult(answer=answer, steps_used=step, transcript=transcript, finished=True)
            transcript.append(f"[خطوة {step}] finish فارغ — تجاهلته.")
            continue

        tool_name = str(parsed.get("tool") or "").strip()
        args = parsed.get("args") if isinstance(parsed.get("args"), dict) else {}
        tool = tools_by_name.get(tool_name)
        if not tool:
            transcript.append(
                f"[خطوة {step}] طلبت أداة غير معروفة ({tool_name or '؟'}) — الأدوات المتاحة: "
                f"{', '.join(tools_by_name)}."
            )
            continue

        try:
            observation = tool.run(args)
        except Exception as e:
            logger.exception("agent_loop: tool %s raised at step %s", tool_name, step)
            observation = f"فشلت الأداة بخطأ حقيقي: {e}"

        transcript.append(f"[خطوة {step}] استدعيت {tool_name}({args}) → {observation}")

    return AgentResult(
        answer="لم أصل لقرار نهائي واثق ضمن عدد الخطوات المسموح — توقفت لتجنب حلقة بلا نهاية.",
        steps_used=max_steps,
        transcript=transcript,
        finished=False,
    )
