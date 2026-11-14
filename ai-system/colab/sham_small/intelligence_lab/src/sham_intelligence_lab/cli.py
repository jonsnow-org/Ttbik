from __future__ import annotations
import argparse, json
from .pipeline import build_dataset


def main() -> None:
    p=argparse.ArgumentParser(prog="sham-intelligence-lab",description="Standalone dataset preparation and evaluation kit")
    sub=p.add_subparsers(dest="command",required=True)
    b=sub.add_parser("build",help="build synthetic curriculum and ingest optional natural/teacher JSONL")
    b.add_argument("--out",required=True)
    b.add_argument("--seed",type=int,default=20261112)
    b.add_argument("--count-per-task",type=int,default=100)
    b.add_argument("--natural-share",type=float,default=.70)
    b.add_argument("--natural-jsonl",action="append",default=[])
    b.add_argument("--teacher-jsonl")
    args=p.parse_args()
    if args.command=="build":
        result=build_dataset(args.out,seed=args.seed,count_per_task=args.count_per_task,
            natural_jsonl=args.natural_jsonl,teacher_jsonl=args.teacher_jsonl,natural_share=args.natural_share)
        print(json.dumps(result,ensure_ascii=False,indent=2))


if __name__=="__main__": main()
