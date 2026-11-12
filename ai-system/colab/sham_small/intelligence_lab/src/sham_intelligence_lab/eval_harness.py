"""Score saved predictions against frozen test records without loading a model."""
from __future__ import annotations

import json
from dataclasses import asdict
from collections import defaultdict
from pathlib import Path
from .schema import Example
from .verifiers import exact_match, numeric_match, evidence_supported
from .uncertainty import calibration_report


def score_predictions(dataset_jsonl: str, predictions_jsonl: str) -> dict:
    dataset={}
    for line in Path(dataset_jsonl).read_text(encoding="utf-8").splitlines():
        if line.strip():
            ex=Example.from_dict(json.loads(line)); dataset[ex.sample_id]=ex
    predictions={}
    for line in Path(predictions_jsonl).read_text(encoding="utf-8").splitlines():
        if line.strip():
            row=json.loads(line)
            sid=row["sample_id"]
            if sid in predictions: raise ValueError(f"duplicate prediction for {sid}")
            predictions[sid]=row
    unknown=set(predictions)-set(dataset)
    if unknown: raise ValueError(f"predictions contain unknown sample IDs: {len(unknown)}")
    metrics=defaultdict(lambda:{"n":0,"correct":0,"answered":0,"abstained":0,"loss_sum":0.0,"loss_n":0,
                                "confidences":[],"confidence_correct":[]})
    conf=[]; corrects=[]
    for sid,ex in dataset.items():
        row=predictions.get(sid)
        if row is None: continue
        pred=str(row.get("prediction","")); abstained=bool(row.get("abstained",False))
        if ex.verifier=="safe_arithmetic":
            from .verifiers import verify_arithmetic
            passed=verify_arithmetic(ex.verification["expression"],pred).passed
        elif ex.verifier=="numeric_match":
            passed=numeric_match(float(ex.verification["expected"]),pred).passed
        elif ex.verifier=="normalized_exact":
            passed=exact_match(str(ex.verification["expected"]),pred).passed
        elif ex.verifier=="evidence_substring":
            expected_source=str(ex.verification.get("source_id", ""))
            pred_answer=str(row.get("answer", pred))
            pred_source=str(row.get("source_id", ""))
            supported=evidence_supported(pred_answer,[x.text for x in ex.evidence]).passed
            cited=pred_source==expected_source and any(x.source_id==pred_source for x in ex.evidence)
            passed=supported and cited
        elif ex.verifier=="logical_entailment":
            answer=pred.strip()
            label=("entailed" if answer.startswith("نعم") else "undetermined" if answer.startswith("لا يمكن استنتاج") or answer.startswith("لا يمكن الجزم") else "not_entailed" if answer.startswith("لا") else "unknown")
            passed=label==ex.verification.get("label")
        elif ex.verifier=="abstain_expected":
            passed=abstained
        else:
            # Non-deterministic tasks require a separately reviewed human_correct annotation.
            passed=row.get("human_correct")
            if passed is None: continue
        m=metrics[ex.task]; m["n"]+=1; m["correct"]+=int(bool(passed))
        m["abstained"]+=int(abstained); m["answered"]+=int(not abstained)
        if row.get("loss") is not None:
            m["loss_sum"]+=float(row["loss"]); m["loss_n"]+=1
        if row.get("confidence") is not None:
            confidence=float(row["confidence"])
            conf.append(confidence); corrects.append(bool(passed))
            m["confidences"].append(confidence); m["confidence_correct"].append(bool(passed))
    out={}
    for task,m in metrics.items():
        task_calibration=calibration_report(m["confidences"],m["confidence_correct"]) if m["confidences"] else None
        out[task]={"n":m["n"],"accuracy":m["correct"]/max(m["n"],1),
                   "coverage":m["answered"]/max(m["n"],1),"abstention_rate":m["abstained"]/max(m["n"],1),
                   "loss":m["loss_sum"]/m["loss_n"] if m["loss_n"] else None,
                   "ece":task_calibration.ece if task_calibration else None,
                   "brier":task_calibration.brier if task_calibration else None}
    calibration=asdict(calibration_report(conf,corrects)) if conf else None
    return {"tasks":out,"calibration":calibration,"scored_predictions":sum(x["n"] for x in metrics.values()),
            "unmatched_dataset_examples":len(set(dataset)-set(predictions)),
            "note":"Evidence substring scores are lexical only; tasks without deterministic verifiers require human_correct annotations."}


def write_report(result: dict, path: str) -> None:
    Path(path).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding="utf-8")
