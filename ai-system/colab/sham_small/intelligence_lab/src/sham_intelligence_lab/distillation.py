"""Teacher-output ingestion and multi-stage distillation dataset preparation.

No provider keys, model clients, or Sham runtime imports are included. Engineers
supply teacher records through the versioned JSONL contract.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable

from .schema import Example, example_from_teacher
from .verifiers import exact_match, numeric_match, safe_arithmetic, evidence_supported


def ingest_teacher_jsonl(path: str | Path) -> tuple[list[Example], dict]:
    accepted=[]; rejected=[]
    for line_no,line in enumerate(Path(path).read_text(encoding="utf-8").splitlines(),1):
        if not line.strip(): continue
        try:
            raw=json.loads(line)
            ex=example_from_teacher(prompt=raw["prompt"],target=raw["target"],task=raw.get("task","distilled_sft"),
                teacher_id=raw["teacher_id"], explanation=raw.get("explanation",""),
                confidence=raw.get("confidence"), parent_ids=raw.get("parent_ids",[]),
                metadata=raw.get("metadata",{}), verifier=raw.get("verifier","none"),
                verification=raw.get("verification",{}), difficulty=int(raw.get("difficulty",2)))
            ex.validate(); accepted.append(ex)
        except Exception as exc:
            rejected.append({"line":line_no,"reason":f"{type(exc).__name__}: {exc}"})
    return accepted,{"accepted":len(accepted),"rejected":rejected}


def distillation_stages(examples: Iterable[Example]) -> dict[str,list[Example]]:
    """Partition already-reviewed records; stage progression is explicit."""
    rows=list(examples)
    return {
        "stage_1_behavior": [x for x in rows if x.task in ("natural_sft","distilled_sft")],
        "stage_2_verifiable_reasoning": [x for x in rows if x.task=="reasoning" and x.verifier!="none"],
        "stage_3_evidence_grounding": [x for x in rows if x.task=="evidence"],
        "stage_4_uncertainty": [x for x in rows if x.task=="uncertainty"],
        "stage_5_repair_and_transfer": [x for x in rows if x.task in ("repair","tool_judgement","preference")],
    }


def verify_example(ex: Example) -> dict:
    """Run only registered deterministic verifiers; unknown verifiers fail closed."""
    spec=ex.verification
    if ex.verifier=="safe_arithmetic":
        result=numeric_match(float(safe_arithmetic(spec["expression"])),ex.target)
    elif ex.verifier=="numeric_match":
        result=numeric_match(float(spec["expected"]),ex.target)
    elif ex.verifier=="normalized_exact":
        result=exact_match(str(spec["expected"]),ex.target)
    elif ex.verifier == "evidence_substring":
        expected_answer=str(spec.get("answer", ""))
        expected_source=str(spec.get("source_id", ""))
        supported=evidence_supported(expected_answer,[item.text for item in ex.evidence])
        cited=(f"[المصدر: {expected_source}]" in ex.target) and any(item.source_id==expected_source for item in ex.evidence)
        from .verifiers import VerificationResult
        result=VerificationResult(supported.passed and cited,"evidence_answer_and_citation",
                                 {"answer":expected_answer,"source_id":expected_source},
                                 {"answer_supported":supported.passed,"citation_present":cited})
    elif ex.verifier == "abstain_expected":
        from .verifiers import VerificationResult
        passed=ex.target.strip().startswith(("لا تذكر المعلومة", "لا تذكر المقاطع المتاحة"))
        result=VerificationResult(passed,"abstention_template",True,passed)
    elif ex.verifier == "logical_entailment":
        target=ex.target.strip()
        actual=("entailed" if target.startswith("نعم") else "undetermined" if target.startswith("لا يمكن استنتاج") or target.startswith("لا يمكن الجزم") else "not_entailed" if target.startswith("لا") else "unknown")
        from .verifiers import VerificationResult
        result=VerificationResult(actual==spec.get("label"),"logical_label",spec.get("label"),actual)
    elif ex.verifier in ("none","labelled_decision"):
        return {"passed":None,"verifier":ex.verifier,"detail":"Requires task-specific review or policy evaluator"}
    else:
        return {"passed":False,"verifier":ex.verifier,"detail":"Unknown verifier; rejected by default"}
    return result.as_dict()
