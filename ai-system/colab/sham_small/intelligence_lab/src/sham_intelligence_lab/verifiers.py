"""Deterministic verifiers. Verification is explicit and auditable; no model call."""
from __future__ import annotations

import ast
import math
import operator
import re
from dataclasses import dataclass
from typing import Any, Callable


@dataclass(slots=True)
class VerificationResult:
    passed: bool
    verifier: str
    expected: Any
    actual: Any
    score: float = 1.0
    detail: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {"passed": self.passed, "verifier": self.verifier, "expected": self.expected,
                "actual": self.actual, "score": self.score, "detail": self.detail}


def normalize_answer(text: str) -> str:
    text = text.casefold().strip()
    text = re.sub(r"[\u064B-\u065F\u0670]", "", text)
    text = text.replace("أ", "ا").replace("إ", "ا").replace("آ", "ا").replace("ى", "ي")
    text = re.sub(r"[^\w\u0600-\u06ff.+-]", " ", text)
    return " ".join(text.split())


def exact_match(expected: str, actual: str) -> VerificationResult:
    ok = normalize_answer(expected) == normalize_answer(actual)
    return VerificationResult(ok, "normalized_exact", expected, actual, 1.0 if ok else 0.0)


def numeric_value(text: str) -> float | None:
    # Supports decimal numbers and Arabic-Indic digits; rejects ambiguous multi-number answers.
    translate = str.maketrans("٠١٢٣٤٥٦٧٨٩٫٬", "0123456789.,")
    found = re.findall(r"(?<![\w])[-+]?(?:\d+(?:[.,]\d+)?)(?![\w])", text.translate(translate))
    if len(found) != 1:
        return None
    try:
        return float(found[0].replace(",", "."))
    except ValueError:
        return None


def numeric_match(expected: float, actual: str, *, atol: float = 1e-6, rtol: float = 1e-6) -> VerificationResult:
    value = numeric_value(actual)
    ok = value is not None and math.isclose(float(expected), value, abs_tol=atol, rel_tol=rtol)
    return VerificationResult(ok, "numeric_tolerance", expected, value,
                              1.0 if ok else 0.0, f"atol={atol}, rtol={rtol}")


_ALLOWED_BINOPS: dict[type, Callable[[Any, Any], Any]] = {
    ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul,
    ast.FloorDiv: operator.floordiv, ast.Mod: operator.mod,
}
_ALLOWED_UNARY: dict[type, Callable[[Any], Any]] = {ast.UAdd: operator.pos, ast.USub: operator.neg}


def safe_arithmetic(expression: str) -> int | float:
    """Evaluate a tiny arithmetic grammar; no eval(), names, calls, attributes or imports."""
    if len(expression) > 120:
        raise ValueError("expression too long")
    node = ast.parse(expression, mode="eval").body

    def visit(n: ast.AST) -> int | float:
        if isinstance(n, ast.Constant) and isinstance(n.value, (int, float)) and not isinstance(n.value, bool):
            if abs(n.value) > 10**12:
                raise ValueError("literal exceeds bound")
            return n.value
        if isinstance(n, ast.BinOp) and type(n.op) in _ALLOWED_BINOPS:
            a, b = visit(n.left), visit(n.right)
            if isinstance(n.op, (ast.FloorDiv, ast.Mod)) and b == 0:
                raise ZeroDivisionError("division by zero")
            result = _ALLOWED_BINOPS[type(n.op)](a, b)
            if abs(result) > 10**15:
                raise ValueError("result exceeds bound")
            return result
        if isinstance(n, ast.UnaryOp) and type(n.op) in _ALLOWED_UNARY:
            return _ALLOWED_UNARY[type(n.op)](visit(n.operand))
        raise ValueError(f"unsupported arithmetic syntax: {type(n).__name__}")

    return visit(node)


def verify_arithmetic(expression: str, claimed: str) -> VerificationResult:
    try:
        expected = safe_arithmetic(expression)
    except Exception as exc:
        return VerificationResult(False, "safe_arithmetic", None, claimed, 0.0, str(exc))
    return numeric_match(float(expected), claimed)


def evidence_supported(answer: str, evidence_texts: list[str]) -> VerificationResult:
    """Conservative lexical support check; not a semantic entailment proof."""
    expected = normalize_answer(answer)
    haystacks = [normalize_answer(t) for t in evidence_texts]
    passed = bool(expected) and any(expected in h for h in haystacks)
    return VerificationResult(passed, "evidence_substring", answer, evidence_texts,
                              1.0 if passed else 0.0,
                              "Lexical support only; semantic entailment still requires human/teacher review")


def verify_choice(expected: str, actual: str, allowed: set[str]) -> VerificationResult:
    choice = normalize_answer(actual)
    valid = {normalize_answer(v) for v in allowed}
    ok = choice in valid and choice == normalize_answer(expected)
    return VerificationResult(ok, "closed_choice", expected, actual, 1.0 if ok else 0.0,
                              "actual must be one of the declared choices")
