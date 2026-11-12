"""Deterministic natural/synthetic/teacher mixing with per-task quotas."""
from __future__ import annotations

from collections import defaultdict
import random
from typing import Iterable

from .schema import Example


def deduplicate(examples: Iterable[Example]) -> tuple[list[Example], int]:
    seen=set(); kept=[]; duplicates=0
    for ex in examples:
        ex.validate()
        key=(ex.task, " ".join(ex.prompt.casefold().split()), " ".join(ex.target.casefold().split()))
        if key in seen:
            duplicates += 1
            continue
        seen.add(key); kept.append(ex)
    return kept, duplicates


def quality_weight(ex: Example) -> float:
    base = {"natural": 1.0, "synthetic": 0.75, "teacher": 0.85}[ex.source_kind]
    if ex.verifier not in ("none", "abstain_expected", "labelled_decision"):
        base *= 1.15 if ex.verification.get("passed", True) else 0.0
    if ex.metadata.get("teacher_output_is_unverified"):
        base *= 0.6
    return base


def balanced_mix(examples: Iterable[Example], *, natural_share: float = 0.70,
                 seed: int = 0) -> tuple[list[Example], dict]:
    if not 0.0 <= natural_share <= 1.0:
        raise ValueError("natural_share must be in [0, 1]")
    all_items, duplicates = deduplicate(examples)
    items=[x for x in all_items if x.source_kind!="teacher" or (x.metadata.get("reviewed") is True and x.metadata.get("verification_status")=="passed")]
    unverified_teacher_excluded=sum(x.source_kind=="teacher" for x in all_items)-sum(x.source_kind=="teacher" for x in items)
    by_task: dict[str, list[Example]] = defaultdict(list)
    for ex in items:
        by_task[ex.task].append(ex)
    rng = random.Random(seed)
    selected=[]; report={"duplicates_removed":duplicates,"unverified_teacher_excluded":unverified_teacher_excluded,"tasks":{},"natural_share_target":natural_share}
    for task, rows in sorted(by_task.items()):
        natural=[x for x in rows if x.source_kind == "natural"]
        synthetic=[x for x in rows if x.source_kind != "natural"]
        total=len(rows)
        n_nat=min(len(natural), round(total*natural_share))
        n_syn=min(len(synthetic), total-n_nat)
        if n_nat+n_syn < total:
            n_nat=min(len(natural), total-n_syn)
            n_syn=min(len(synthetic), total-n_nat)
        natural.sort(key=lambda x:(-quality_weight(x),x.sample_id))
        synthetic.sort(key=lambda x:(-quality_weight(x),x.sample_id))
        chosen=natural[:n_nat]+synthetic[:n_syn]
        rng.shuffle(chosen)
        selected.extend(chosen)
        report["tasks"][task]={"available":total,"natural":len(natural),"synthetic_or_teacher":len(synthetic),
                                "selected":len(chosen),"actual_natural_share":sum(x.source_kind=="natural" for x in chosen)/max(1,len(chosen))}
    rng.shuffle(selected)
    return selected, report
