"""How sure is a held-out score? With 12-14 tasks, one task is 7-8 points, so a score just above or below a gate says little.
verdict(k, n, gate) -> 'pass' | 'fail' | 'inconclusive' from the 95% Wilson interval of k/n (stdlib only)."""
import math


def wilson(k: int, n: int, z: float = 1.96):
    if n <= 0:
        return 0.0, 1.0
    p = k / n
    den = 1 + z * z / n
    c = (p + z * z / (2 * n)) / den
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return max(0.0, c - h), min(1.0, c + h)


def verdict(k: int, n: int, gate: float) -> str:
    lo, hi = wilson(k, n)
    return "pass" if lo >= gate else ("fail" if hi < gate else "inconclusive")
