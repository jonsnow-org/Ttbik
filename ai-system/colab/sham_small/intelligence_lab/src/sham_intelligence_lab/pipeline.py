"""Standalone dataset build/export pipeline. No production model is loaded."""
from __future__ import annotations

import json
from pathlib import Path
from collections import Counter

from .curriculum import DEFAULT_STAGES, curriculum_view
from .distillation import ingest_teacher_jsonl, verify_example, distillation_stages
from .generators import generate_curriculum
from .mixture import balanced_mix
from .schema import Example
from .splits import split_by_group, assert_no_group_leakage


def load_natural_jsonl(paths: list[str]) -> tuple[list[Example],list[dict]]:
    rows=[]; errors=[]
    for path in paths:
        for line_no,line in enumerate(Path(path).read_text(encoding="utf-8").splitlines(),1):
            if not line.strip(): continue
            try:
                raw=json.loads(line)
                raw.setdefault("source_kind","natural")
                raw.setdefault("task","natural_sft")
                raw.setdefault("source_id",f"natural:{Path(path).name}")
                raw.setdefault("split_group",raw.get("source_id",f"natural-source:{Path(path).name}"))
                raw.setdefault("metadata",{})
                raw["metadata"].setdefault("ingest_file",Path(path).name)
                raw["metadata"].setdefault("ingest_line",line_no)
                rows.append(Example.from_dict(raw))
            except Exception as exc:
                errors.append({"file":path,"line":line_no,"reason":f"{type(exc).__name__}: {exc}"})
    return rows,errors


def write_jsonl(path: Path, examples: list[Example]) -> None:
    path.parent.mkdir(parents=True,exist_ok=True)
    with path.open("w",encoding="utf-8") as f:
        for ex in examples: f.write(ex.to_jsonl()+"\n")


def build_dataset(out_dir: str, *, seed: int=20261112, count_per_task: int=100,
                  natural_jsonl: list[str]|None=None, teacher_jsonl: str|None=None,
                  natural_share: float=.70) -> dict:
    out=Path(out_dir); out.mkdir(parents=True,exist_ok=True)
    synthetic=generate_curriculum(seed,count_per_task)
    natural,natural_errors=load_natural_jsonl(natural_jsonl or [])
    teacher=[]; teacher_report={"accepted":0,"rejected":[]}
    if teacher_jsonl:
        teacher,teacher_report=ingest_teacher_jsonl(teacher_jsonl)
    teacher_quarantine=[x for x in teacher if not (x.metadata.get("reviewed") is True and x.metadata.get("verification_status")=="passed")]
    teacher_eligible=[]
    teacher_rejected=[]
    for ex in teacher:
        if ex in teacher_quarantine: continue
        verdict=verify_example(ex)
        if verdict.get("passed") is False:
            teacher_rejected.append({"sample_id":ex.sample_id,"reason":"independent_verifier_failed","verification":verdict})
        else:
            teacher_eligible.append(ex)
    rows=synthetic+natural+teacher_eligible
    mixed,mix_report=balanced_mix(rows,natural_share=natural_share,seed=seed)
    write_jsonl(out/"quarantine/teacher_unreviewed.jsonl",teacher_quarantine)
    (out/"quarantine/teacher_rejected.jsonl").write_text("".join(json.dumps(x,ensure_ascii=False)+"\n" for x in teacher_rejected),encoding="utf-8")
    splits=split_by_group(mixed,seed=seed)
    assert_no_group_leakage(splits)
    # Build curriculum and explicit distillation-stage views from TRAIN only; dev/test remain untouched.
    stage_reports={}
    for index,stage in enumerate(DEFAULT_STAGES,1):
        view=curriculum_view(splits["train"],stage)
        write_jsonl(out/f"curriculum/stage_{index}_{stage.name}.jsonl",view)
        stage_reports[stage.name]={"examples":len(view),"tasks":dict(Counter(x.task for x in view))}
    distill_reports={}
    for stage_name,stage_rows in distillation_stages(splits["train"]).items():
        write_jsonl(out/f"distillation/{stage_name}.jsonl",stage_rows)
        distill_reports[stage_name]={"examples":len(stage_rows),"tasks":dict(Counter(x.task for x in stage_rows))}
    for split,part in splits.items(): write_jsonl(out/f"{split}.jsonl",part)
    verification=[]
    for ex in mixed:
        report=verify_example(ex)
        verification.append({"sample_id":ex.sample_id,**report})
    (out/"verification.jsonl").write_text("".join(json.dumps(x,ensure_ascii=False)+"\n" for x in verification),encoding="utf-8")
    report={"schema_version":"sil-1.0","seed":seed,"total":len(mixed),"splits":{k:len(v) for k,v in splits.items()},
            "task_counts":dict(Counter(x.task for x in mixed)),"source_counts":dict(Counter(x.source_kind for x in mixed)),
            "natural_errors":natural_errors,"teacher_ingestion":teacher_report,"teacher_quarantine":len(teacher_quarantine),"teacher_rejected":teacher_rejected,"mixture":mix_report,
            "curriculum":stage_reports,"distillation_stages":distill_reports,"verification":{"passed":sum(x["passed"] is True for x in verification),
            "failed":sum(x["passed"] is False for x in verification),"needs_review":sum(x["passed"] is None for x in verification)},
            "natural_license_unknown":sum(1 for x in natural if not x.metadata.get("license")),
            "note":"Synthetic records are research seeds, not evidence of model capability. Unreviewed teacher outputs are quarantined, not trained. Review all sources and licenses before training."}
    (out/"build_report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    return report
