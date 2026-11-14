"""Difficulty scheduling and prerequisite-aware curriculum plans."""
from __future__ import annotations

from dataclasses import dataclass
from collections import defaultdict
from typing import Iterable

from .schema import Example


@dataclass(frozen=True, slots=True)
class CurriculumStage:
    name: str
    min_difficulty: int
    max_difficulty: int
    task_weights: dict[str, float]
    mastery_threshold: float = 0.82


DEFAULT_STAGES = (
    CurriculumStage("foundation", 1, 2, {"natural_sft": .20, "distilled_sft": .15, "reasoning": .25, "evidence": .15, "uncertainty": .15, "repair": .10}),
    CurriculumStage("competence", 2, 4, {"natural_sft": .10, "distilled_sft": .15, "reasoning": .25, "evidence": .25, "uncertainty": .15, "repair": .10}),
    CurriculumStage("transfer", 3, 5, {"natural_sft": .15, "distilled_sft": .20, "reasoning": .25, "evidence": .20, "uncertainty": .10, "repair": .10}),
)


def curriculum_view(examples: Iterable[Example], stage: CurriculumStage) -> list[Example]:
    allowed=[x for x in examples if stage.min_difficulty <= x.difficulty <= stage.max_difficulty
             and stage.task_weights.get(x.task, 0.0) > 0]
    groups: dict[str,list[Example]]=defaultdict(list)
    for ex in allowed: groups[ex.task].append(ex)
    out=[]; tasks=sorted(groups)
    while any(groups.values()):
        for task in tasks:
            if groups[task]: out.append(groups[task].pop(0))
    return out


def promote_stage(stage_index: int, measured_mastery: dict[str,float], stages=DEFAULT_STAGES) -> int:
    """Only promote when every active task reaches mastery; otherwise stay put."""
    if stage_index >= len(stages)-1: return stage_index
    stage=stages[stage_index]
    scores=[measured_mastery.get(task,0.0) for task,weight in stage.task_weights.items() if weight>0]
    return stage_index+1 if scores and min(scores)>=stage.mastery_threshold else stage_index
