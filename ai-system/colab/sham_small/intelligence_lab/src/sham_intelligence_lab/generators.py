"""Deterministic, verifiable task generators for curriculum and skill rehearsal."""
from __future__ import annotations

import random

from .schema import Example, Evidence
from .verifiers import safe_arithmetic


def arithmetic_examples(seed: int, count: int, difficulty: int = 1) -> list[Example]:
    rng = random.Random(seed)
    out: list[Example] = []
    for i in range(count):
        level = max(1, min(5, difficulty if difficulty else 1))
        terms = 2 if level <= 2 else 3 if level <= 4 else 4
        nums = [rng.randint(2, 15 * level) for _ in range(terms)]
        ops = [rng.choice(["+", "-"]) if level <= 2 else rng.choice(["+", "-", "*"]) for _ in range(terms - 1)]
        expr = str(nums[0])
        for op, n in zip(ops, nums[1:]):
            expr += f" {op} {n}"
        answer = str(safe_arithmetic(expr))
        prompt = f"احسب الناتج بدقة: {expr}. اكتب الناتج النهائي، ويمكنك ذكر ملخص قصير لطريقة الحساب."
        explanation = "تُحل العملية وفق أسبقية الضرب على الجمع والطرح، ثم تُنفذ العمليات المتبقية بالترتيب."
        out.append(Example(prompt, answer, "reasoning", "synthetic", difficulty=level,
                           verifier="safe_arithmetic", verification={"expression": expr, "expected": answer},
                           explanation=explanation, source_id=f"generator:arithmetic:v1:{seed}:{i}"))
    return out


def evidence_examples(seed: int, count: int, difficulty: int = 1) -> list[Example]:
    """Evidence QA with distractor passages, source citations and no-answer cases."""
    rng = random.Random(seed)
    facts = [
        ("تدور الأرض حول الشمس، وتستغرق الدورة الواحدة نحو 365 يوماً وربع اليوم.", "365 يوماً وربع اليوم", "مدة دورة الأرض حول الشمس"),
        ("يتكون الماء النقي من ذرتي هيدروجين وذرة أكسجين، وصيغته الكيميائية H2O.", "H2O", "الصيغة الكيميائية للماء"),
        ("تقع مدينة مراكش في المغرب، وتشتهر بمدينتها القديمة وأسواقها التاريخية.", "المغرب", "الدولة التي تقع فيها مراكش"),
        ("تستخدم النباتات الخضراء ضوء الشمس في عملية البناء الضوئي لإنتاج السكريات.", "البناء الضوئي", "العملية التي تستخدم فيها النباتات الضوء"),
        ("تتكون الخلية العصبية من جسم خلوي ومحور عصبي وتفرعات شجيرية.", "محور عصبي", "جزء ينقل الإشارة بعيداً عن جسم الخلية"),
        ("تبلغ سرعة الضوء في الفراغ نحو 299,792 كيلومتراً في الثانية.", "299,792 كيلومتراً في الثانية", "سرعة الضوء التقريبية"),
    ]
    out: list[Example] = []
    for i in range(count):
        missing = rng.random() < 0.30
        relevant_index = rng.randrange(len(facts))
        selected = [relevant_index]
        distractors = [j for j in range(len(facts)) if j != relevant_index]
        selected.extend(rng.sample(distractors, k=2))
        rng.shuffle(selected)
        evidence=[]
        for index in selected:
            passage, _, _ = facts[index]
            evidence.append(Evidence(source_id=f"fact-card-{index+1}", title="بطاقة معرفة تجريبية",
                                     text=passage, license="CC0-generated", locator=f"fact-card-{index+1}"))
        context = "\n".join(f"[المصدر: {ev.source_id}] {ev.text}" for ev in evidence)
        if missing:
            question = rng.choice(["ما عدد سكان مدينة نوران اليوم؟", "في أي سنة نُشر هذا النص؟", "ما اسم مكتشف هذه المعلومة؟"])
            target = "لا تذكر المقاطع المتاحة هذه المعلومة، لذلك لا يمكنني تحديد الإجابة منها وحدها."
            verifier = "abstain_expected"
            expected = {"decision": "insufficient_evidence"}
            confidence = "abstain"
        else:
            _, answer, question = facts[relevant_index]
            source_id = f"fact-card-{relevant_index+1}"
            target = f"{answer} [المصدر: {source_id}]"
            verifier = "evidence_substring"
            expected = {"answer": answer, "source_id": source_id}
            confidence = "high"
        prompt = f"أجب اعتماداً على المقاطع فقط. ميّز بين المعلومة المدعومة والمقاطع المشتتة. اذكر معرّف المصدر الذي يدعم إجابتك. إذا لم توجد إجابة أو تعارضت المصادر فصرّح بذلك.\nالمقاطع:\n{context}\nالسؤال: {question}"
        out.append(Example(prompt, target, "evidence", "synthetic", difficulty=max(1,difficulty),
                           verifier=verifier, verification=expected, evidence=evidence,
                           confidence_label=confidence,
                           source_id=f"generator:evidence:v2:{seed}:{i}",
                           split_group=f"evidence-card:{relevant_index}" if not missing else f"evidence-noanswer:{question}"))
    return out


def uncertainty_examples(seed: int, count: int) -> list[Example]:
    rng = random.Random(seed)
    patterns = [
        ("كم عدد سكان مدينة خيالية اسمها نوران اليوم؟", "لا أملك بيانات موثوقة وحديثة عن هذا العدد، لذلك لا أستطيع الجزم به.", "abstain", 1),
        ("ما ناتج 18 × 7؟", "126", "high", 1),
        ("هل العبارة صحيحة؟ النص يقول إن الموعد قد يتغير، ولا يحدد تاريخاً نهائياً.", "لا يمكن تأكيد تاريخ نهائي من المعلومات المتاحة.", "low", 2),
        ("تذكر روايتان تاريخين مختلفين للحدث. ما التاريخ المؤكد؟", "المعلومات متعارضة؛ أحتاج إلى مصدر موثوق إضافي قبل تحديد تاريخ واحد.", "medium", 3),
    ]
    out=[]
    for i in range(count):
        prompt, target, label, diff = patterns[i % len(patterns)]
        if rng.random() < 0.3:
            prompt = "قيّم مدى كفاية المعلومات ثم أجب: " + prompt
        out.append(Example(prompt, target, "uncertainty", "synthetic", difficulty=diff,
                           verifier="labelled_decision", verification={"confidence_label": label},
                           confidence_label=label, source_id=f"generator:uncertainty:v1:{seed}:{i}",
                           split_group=f"uncertainty-template:{i % len(patterns)}"))
    return out


def repair_examples(seed: int, count: int) -> list[Example]:
    rng = random.Random(seed)
    out=[]
    for i in range(count):
        a, b = rng.randint(1, 50), rng.randint(1, 50)
        bad = a + b + rng.choice([-2, -1, 1, 2])
        good = a + b
        prompt = f"راجع الحل التالي واكتشف الخطأ ثم صححه: {a} + {b} = {bad}."
        target = f"الناتج الصحيح هو {good}."
        out.append(Example(prompt, target, "repair", "synthetic", difficulty=2,
                           verifier="numeric_match", verification={"expected": good},
                           explanation="إعادة حساب العملية مستقلاً تكشف اختلاف الناتج المعروض عن الناتج الصحيح.",
                           source_id=f"generator:repair:v1:{seed}:{i}"))
    return out


def logic_examples(seed: int, count: int) -> list[Example]:
    """Truth-functional entailment tasks whose labels are generated by explicit rules."""
    rng = random.Random(seed)
    templates = [
        ("كل {a} هي {b}. {x} هو {a}. هل نستنتج أن {x} هو {b}؟", True),
        ("لا ينتمي أي {a} إلى {b}. {x} ينتمي إلى {a}. هل ينتمي {x} إلى {b}؟", False),
        ("كل {a} هي {b}. {x} هو {b}. هل يلزم من ذلك أن {x} هو {a}؟", None),
    ]
    out=[]
    nouns=[("الطيور","الحيوانات","هذا الكائن"),("المربعات","الأشكال الرباعية","هذا الشكل"),
           ("الأطباء","العاملون","هذا الشخص"),("الكواكب","الأجرام السماوية","هذا الجرم"),
           ("الأشجار","النباتات","هذه الشجرة")]
    for i in range(count):
        case=templates[i%len(templates)][1]
        aa,bb,xx=nouns[(i//len(templates))%len(nouns)]
        if case is True:
            prompt=f"كل {aa} هي {bb}. {xx} من {aa}. هل يلزم أنه من {bb}؟"
            answer="نعم، النتيجة تلزم من المقدمتين."; label="entailed"; case_name="affirmative"
        elif case is False:
            prompt=f"لا ينتمي أي {aa} إلى {bb}. {xx} من {aa}. هل ينتمي إلى {bb}؟"
            answer="لا، المقدمة الأولى تستبعد انتماء الفئتين معًا."; label="not_entailed"; case_name="disjoint"
        else:
            prompt=f"كل {aa} هي {bb}. {xx} من {bb}. هل يلزم من ذلك أنه من {aa}؟"
            answer="لا يمكن استنتاج ذلك؛ فقد يكون الشيء من الفئة الأوسع دون أن يكون من الفئة الأضيق."; label="undetermined"; case_name="affirming_the_consequent"
        out.append(Example(prompt,answer,"reasoning","synthetic",difficulty=3 if case is None else 2,
            verifier="logical_entailment",verification={"label":label,"case":case_name},
            explanation="يجب التمييز بين ما تسمح به المقدمات وما لا يلزم عنها منطقيًا.",
            source_id=f"generator:logic:v1:{seed}:{i}",split_group=f"logic-template:{i%3}"))
    return out


def generate_curriculum(seed: int, count_per_task: int = 100) -> list[Example]:
    """Builds a compact, deterministic seed set; scale by repeated seeded batches."""
    examples: list[Example] = []
    for level in range(1, 6):
        examples.extend(arithmetic_examples(seed + level * 101, count_per_task, level))
    examples.extend(evidence_examples(seed + 701, count_per_task * 3, 2))
    examples.extend(logic_examples(seed + 809, count_per_task * 2))
    examples.extend(uncertainty_examples(seed + 907, count_per_task * 2))
    examples.extend(repair_examples(seed + 1103, count_per_task))
    return examples
