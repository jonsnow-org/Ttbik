"""Non-regression gate for multi-task training experiments."""
from __future__ import annotations

from dataclasses import dataclass, asdict


@dataclass(frozen=True, slots=True)
class GatePolicy:
    min_macro_improvement: float = 0.005
    max_task_regression: float = 0.02
    max_accuracy_drop: float = 0.01
    required_tasks: tuple[str,...] = ("reasoning","evidence","uncertainty","natural_sft")
    min_examples_per_task: int = 100
    max_ece: float = 0.12


def evaluate_gate(baseline: dict, candidate: dict, counts: dict[str,int], *, policy: GatePolicy=GatePolicy()) -> dict:
    """Expected per-task shape: loss, accuracy, and count. ECE is required for uncertainty."""
    missing=[t for t in policy.required_tasks if t not in baseline or t not in candidate]
    small=[t for t in policy.required_tasks if counts.get(t,0)<policy.min_examples_per_task]
    rows={}; regressions=[]; accuracy_regressions=[]; improvements=[]
    for task in policy.required_tasks:
        if task not in baseline or task not in candidate: continue
        b=float(baseline[task]["loss"]); c=float(candidate[task]["loss"])
        if b<=0: rows[task]={"relative_loss_change":None}; continue
        delta=(c-b)/b
        b_acc=baseline[task].get("accuracy"); c_acc=candidate[task].get("accuracy")
        rows[task]={"baseline_loss":b,"candidate_loss":c,"relative_loss_change":delta,
                    "baseline_accuracy":b_acc,"candidate_accuracy":c_acc,
                    "accuracy_change":(c_acc-b_acc) if b_acc is not None and c_acc is not None else None,
                    "n":counts.get(task,0)}
        if delta>policy.max_task_regression: regressions.append(task)
        if b_acc is not None and c_acc is not None and c_acc < b_acc-policy.max_accuracy_drop: accuracy_regressions.append(task)
        if delta<0: improvements.append(task)
    deltas=[r["relative_loss_change"] for r in rows.values() if r.get("relative_loss_change") is not None]
    macro_improvement=-sum(deltas)/len(deltas) if deltas else 0.0
    ece=candidate.get("uncertainty",{}).get("ece")
    failures=[]
    if missing: failures.append("missing_required_tasks:"+",".join(missing))
    if small: failures.append("insufficient_eval_examples:"+",".join(small))
    if regressions: failures.append("task_regression:"+",".join(regressions))
    if accuracy_regressions: failures.append("accuracy_regression:"+",".join(accuracy_regressions))
    if macro_improvement<policy.min_macro_improvement: failures.append("macro_improvement_below_threshold")
    if ece is None or float(ece)>policy.max_ece: failures.append("uncertainty_calibration_missing_or_poor")
    return {"accepted":not failures,"macro_relative_improvement":macro_improvement,"improved_tasks":improvements,
            "regressed_tasks":regressions,"accuracy_regressed_tasks":accuracy_regressions,"ece":ece,
            "policy":asdict(policy),"task_metrics":rows,"failures":failures}
