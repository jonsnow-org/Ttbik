"""Builds code-repair (debugging) rows from solutions that come with tests (OpenCodeInstruct unit_tests, opc-sft-stage2
educational_instruct testcase). For each solution a single bug is injected with an AST mutation; the row is kept only if
the mutated code FAILS its tests and the original PASSES them. The prompt shows the buggy code and the failing test output;
the target is a short diagnosis plus the fixed code. Tests run in a throw-away subprocess with a time limit (run this inside a
container or the coder sandbox, never on a machine with secrets).

    python scripts/make_repair_tasks.py --n 20000 --out data/synth_repair.jsonl
"""
import argparse
import ast
import json
import random
import subprocess
import sys
import tempfile
from pathlib import Path

from datasets import load_dataset

SYSTEM = "You are Nova 1, a careful software engineer. Find the bug, explain it in one or two sentences, and return the fixed code."
AR_SHARE = 0.25   # a quarter of the prompts in Arabic; code and test output stay as they are


class Mutator(ast.NodeTransformer):
    """Applies exactly one mutation, chosen at random among the eligible nodes."""

    KINDS = ("cmp", "binop", "const", "slice", "bool")

    def __init__(self, target: int):
        self.target, self.i, self.kind = target, 0, None

    def _hit(self) -> bool:
        self.i += 1
        return self.i == self.target

    def visit_Compare(self, n):
        self.generic_visit(n)
        swap = {ast.Lt: ast.LtE, ast.LtE: ast.Lt, ast.Gt: ast.GtE, ast.GtE: ast.Gt, ast.Eq: ast.NotEq, ast.NotEq: ast.Eq}
        if type(n.ops[0]) in swap and self._hit():
            n.ops[0], self.kind = swap[type(n.ops[0])](), "comparison"
        return n

    def visit_BinOp(self, n):
        self.generic_visit(n)
        swap = {ast.Add: ast.Sub, ast.Sub: ast.Add, ast.Mult: ast.FloorDiv, ast.FloorDiv: ast.Mult}
        if type(n.op) in swap and self._hit():
            n.op, self.kind = swap[type(n.op)](), "arithmetic operator"
        return n

    def visit_Constant(self, n):
        if isinstance(n.value, int) and not isinstance(n.value, bool) and n.value in (0, 1) and self._hit():
            n.value, self.kind = 1 - n.value, "off-by-one constant"
        return n

    def visit_BoolOp(self, n):
        self.generic_visit(n)
        if self._hit():
            n.op, self.kind = (ast.Or() if isinstance(n.op, ast.And) else ast.And()), "boolean operator"
        return n


def run(code: str, tests: str, timeout: int = 10) -> tuple:
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "t.py"
        p.write_text(code + "\n\n" + tests + "\n")
        try:
            r = subprocess.run([sys.executable, str(p)], capture_output=True, text=True, timeout=timeout, cwd=d)
            return r.returncode == 0, (r.stderr or r.stdout)[-1500:]
        except subprocess.TimeoutExpired:
            return False, "TimeoutError: the tests did not finish in time"


def mutate(code: str):
    try:
        tree = ast.parse(code)
    except SyntaxError:
        return None, None
    m = Mutator(random.randint(1, 12))
    new = m.visit(tree)
    return (ast.unparse(new), m.kind) if m.kind else (None, None)


def sources():
    for r in load_dataset("OpenCoder-LLM/opc-sft-stage2", "educational_instruct", split="train", streaming=True):
        tc = r.get("testcase")
        if r.get("code") and tc:
            yield r["code"], "\n".join(tc) if isinstance(tc, list) else str(tc)
    for r in load_dataset("nvidia/OpenCodeInstruct", split="train", streaming=True):
        if float(r.get("average_test_score") or 0) == 1.0 and r.get("unit_tests"):
            blocks = [b.split("```")[0] for b in (r["output"] or "").split("```python\n")[1:]]
            tests = r["unit_tests"]
            if blocks:
                yield blocks[0], "\n".join(json.loads(tests)) if tests.startswith("[") else tests


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=20000)
    ap.add_argument("--out", default="data/synth_repair.jsonl")
    a = ap.parse_args()
    random.seed(3407)
    made = 0
    with open(a.out, "w") as f:
        for code, tests in sources():
            good, _ = run(code, tests)
            if not good:
                continue
            bad, kind = mutate(code)
            if not bad:
                continue
            fails, log = run(bad, tests)
            if fails:
                continue
            ar = random.random() < AR_SHARE
            ask = ("هذا الكود يفشل في الاختبارات. ابحث عن الخطأ وأصلحه.\n\n" if ar else "This code fails its tests. Find the bug and fix it.\n\n")
            user = f"{ask}```python\n{bad}\n```\n\n{'مخرجات الاختبار' if ar else 'Test output'}:\n```\n{log}\n```"
            why = (f"الخطأ في {kind}: تغيّر سلوك الشرط/العملية فصار الناتج خاطئاً. هذا هو الإصلاح:" if ar else f"The bug is a wrong {kind}; it changes the result. Fixed code:")
            f.write(json.dumps({"messages": [
                {"role": "system", "content": SYSTEM}, {"role": "user", "content": user},
                {"role": "assistant", "content": f"{why}\n\n```python\n{code.strip()}\n```"}]}, ensure_ascii=False) + "\n")
            made += 1
            if made >= a.n:
                break
    print("repair rows:", made)


if __name__ == "__main__":
    main()
