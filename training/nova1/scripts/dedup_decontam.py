"""Exact + near-duplicate removal and benchmark decontamination for data/mix.raw.jsonl.

1. exact: SHA-1 of the normalised (whitespace-collapsed, lower-cased) user turn + final answer
2. near:  MinHash LSH over 5-gram word shingles of the user turn + answer, Jaccard >= 0.85 (datasketch)
3. decon: drop a row if it shares any 13-gram (word) with a prompt or canonical solution of HumanEval+, MBPP+, BigCodeBench,
          LiveCodeBench, or our own eval files (eval/*.jsonl). 13-gram overlap is the rule used for the GPT-3 / StarCoder reports.

    python scripts/dedup_decontam.py data/mix.raw.jsonl data/mix.jsonl
"""
import hashlib
import json
import re
import sys
from pathlib import Path

from datasets import load_dataset
from datasketch import MinHash, MinHashLSH

HERE = Path(__file__).resolve().parent.parent
WORD = re.compile(r"\w+", re.U)
N = 13


def words(t: str) -> list:
    return WORD.findall(t.lower())


def grams(ws: list, n: int) -> set:
    return {" ".join(ws[i : i + n]) for i in range(max(0, len(ws) - n + 1))}


def text_of(row: dict) -> str:
    user = " ".join(m.get("content") or "" for m in row["messages"] if m["role"] == "user")
    last = row["messages"][-1]
    return user + "\n" + (last.get("content") or json.dumps(last.get("tool_calls") or []))


def eval_grams() -> set:
    g: set = set()
    texts = []
    for name, cfg, split, fields in (
        ("evalplus/humanevalplus", None, "test", ("prompt", "canonical_solution")),
        ("evalplus/mbppplus", None, "test", ("prompt", "code")),
        ("bigcode/bigcodebench", None, "v0.1.4", ("complete_prompt", "canonical_solution")),
    ):
        try:
            ds = load_dataset(name, cfg, split=split, trust_remote_code=False) if cfg else load_dataset(name, split=split)
            for r in ds:
                texts += [str(r.get(f) or "") for f in fields]
        except Exception as e:  # a benchmark that cannot be loaded is reported, never silently skipped
            print(f"!! could not load {name}: {e}", file=sys.stderr)
            sys.exit(2)
    # LiveCodeBench (release_v6 = test.jsonl .. test6.jsonl): its hub repo only has a loading script, which datasets>=4 no longer runs,
    # so its JSONL files are streamed directly (about 4.5 GB, read line by line, only question_content kept)
    import urllib.request
    base = "https://huggingface.co/datasets/livecodebench/code_generation_lite/resolve/main/"
    try:
        for f in ("test.jsonl", "test2.jsonl", "test3.jsonl", "test4.jsonl", "test5.jsonl", "test6.jsonl"):
            with urllib.request.urlopen(base + f, timeout=120) as r:
                for line in r:
                    if line.strip():
                        texts.append(str(json.loads(line).get("question_content") or ""))
    except Exception as e:
        print(f"!! could not load livecodebench/code_generation_lite: {e}", file=sys.stderr)
        sys.exit(2)
    for p in (HERE / "eval").glob("*.jsonl"):
        for line in p.open():
            r = json.loads(line)
            texts += [str(r.get("prompt_ar") or ""), str(r.get("prompt_en") or ""), str(r.get("solution") or ""), str(r.get("prompt") or "")]
    for t in texts:
        g |= grams(words(t), N)
    return g


def main(src: str, dst: str) -> None:
    bench = eval_grams()
    lsh = MinHashLSH(threshold=0.85, num_perm=128)
    seen: set = set()
    kept = exact = near = decon = 0
    with open(src) as fi, open(dst, "w") as fo:
        for i, line in enumerate(fi):
            row = json.loads(line)
            t = text_of(row)
            ws = words(t)
            h = hashlib.sha1(" ".join(ws).encode()).hexdigest()
            if h in seen:
                exact += 1
                continue
            seen.add(h)
            if grams(ws, N) & bench:
                decon += 1
                continue
            mh = MinHash(num_perm=128)
            for s in grams(ws, 5):
                mh.update(s.encode())
            if lsh.query(mh):
                near += 1
                continue
            lsh.insert(str(i), mh)
            fo.write(line)
            kept += 1
    print(json.dumps({"kept": kept, "exact_dupes": exact, "near_dupes": near, "contaminated": decon}))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
