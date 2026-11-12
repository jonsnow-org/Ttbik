"""Non-regression gate for multi-task training experiments."""
from __future__ import annotations

import math
from dataclasses import dataclass, asdict


@dataclass(frozen=True, slots=True)
class GatePolicy:
    min_macro_improvement: float = 0.005
    max_task_regression: float = 0.02
    max_accuracy_drop: float = 0.01
    required_tasks: tuple[str, ...] = ("reasoning", "evidence", "uncertainty", "natural_sft")
    min_examples_per_task: int = 100
    max_ece: float = 0.12


def _task_metrics(report: dict) -> dict:
    """Accept either a task-keyed map or eval_harness.score_predictions output."""
    nested = report.get("tasks")
    return nested if isinstance(nested, dict) else report


def evaluate_gate(baseline: dict, candidate: dict, counts: dict[str, int] | None = None,
                  *, policy: GatePolicy = GatePolicy()) -> dict:
    """Compare a candidate with a frozen baseline.

    Each required task must provide positive finite loss and accuracy. The function
    accepts either task-keyed dictionaries or the nested report produced by the
    standalone prediction evaluator. Lower loss is better. Uncertainty ECE may be
    supplied on the uncertainty task or at report.calibration.ece.
    """
    counts = counts or {}
    base_tasks = _task_metrics(baseline)
    cand_tasks = _task_metrics(candidate)
    missing = [t for t in policy.required_tasks if t not in base_tasks or t not in cand_tasks]
    rows = {}
    regressions, accuracy_regressions, improvements = [], [], []
    invalid_metrics, missing_accuracy = [], []
    small = []

    for task in policy.required_tasks:
        if task not in base_tasks or task not in cand_tasks:
            continue
        try:
            b = float(base_tasks[task]["loss"])
            c = float(cand_tasks[task]["loss"])
        except (KeyError, TypeError, ValueError):
            invalid_metrics.append(task)
            continue
        if not math.isfinite(b) or not math.isfinite(c) or b <= 0 or c < 0:
            invalid_metrics.append(task)
            continue
        b_acc = base_tasks[task].get("accuracy")
        c_acc = cand_tasks[task].get("accuracy")
        if b_acc is None or c_acc is None:
            missing_accuracy.append(task)
        else:
            b_acc, c_acc = float(b_acc), float(c_acc)
            if not math.isfinite(b_acc) or not math.isfinite(c_acc) or not 0 <= b_acc <= 1 or not 0 <= c_acc <= 1:
                invalid_metrics.append(task)
                continue
        delta = (c - b) / b
        n = int(counts.get(task, cand_tasks[task].get("n", 0)) or 0)
        if n < policy.min_examples_per_task:
            small.append(task)
        rows[task] = {
            "baseline_loss": b, "candidate_loss": c,
            "relative_loss_change": delta,
            "baseline_accuracy": b_acc, "candidate_accuracy": c_acc,
            "accuracy_change": (c_acc - b_acc) if b_acc is not None and c_acc is not None else None,
            "n": n,
        }
        if delta > policy.max_task_regression:
            regressions.append(task)
        if b_acc is not None and c_acc is not None and c_acc < b_acc - policy.max_accuracy_drop:
            accuracy_regressions.append(task)
        if delta < 0:
            improvements.append(task)

    deltas = [r["relative_loss_change"] for r in rows.values()]
    macro_improvement = -sum(deltas) / len(deltas) if deltas else 0.0
    uncertainty_row = cand_tasks.get("uncertainty", {})
    ece = uncertainty_row.get("ece")
    if ece is None:
        ece = candidate.get("calibration", {}).get("ece")

    failures = []
    if missing:
        failures.append("missing_required_tasks:" + ",".join(missing))
    if small:
        failures.append("insufficient_eval_examples:" + ",".join(small))
    if invalid_metrics:
        failures.append("invalid_metrics:" + ",".join(sorted(set(invalid_metrics))))
    if missing_accuracy:
        failures.append("missing_accuracy:" + ",".join(sorted(set(missing_accuracy))))
    if regressions:
        failures.append("task_regression:" + ",".join(regressions))
    if accuracy_regressions:
        failures.append("accuracy_regression:" + ",".join(accuracy_regressions))
    if macro_improvement < policy.min_macro_improvement:
        failures.append("macro_improvement_below_threshold")
    if ece is None or not math.isfinite(float(ece)) or float(ece) > policy.max_ece:
        failures.append("uncertainty_calibration_missing_or_poor")

    return {
        "accepted": not failures,
        "macro_relative_improvement": macro_improvement,
        "improved_tasks": improvements,
        "regressed_tasks": regressions,
        "accuracy_regressed_tasks": accuracy_regressions,
        "ece": ece,
        "policy": asdict(policy),
        "task_metrics": rows,
        "failures": failures,
    }
