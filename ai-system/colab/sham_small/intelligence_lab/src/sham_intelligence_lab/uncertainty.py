"""Confidence calibration utilities and abstention thresholds."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class CalibrationReport:
    ece: float
    brier: float
    bins: list[dict]
    n: int


def calibration_report(confidences: list[float], correct: list[bool], bins: int=10) -> CalibrationReport:
    if len(confidences)!=len(correct) or not confidences:
        raise ValueError("confidences and correct must be non-empty and equal length")
    if bins <= 0:
        raise ValueError("bins must be positive")
    if any(not 0<=x<=1 for x in confidences):
        raise ValueError("confidence outside [0,1]")
    rows=[]; ece=0.0; n=len(confidences)
    for i in range(bins):
        lo=i/bins; hi=(i+1)/bins
        idx=[j for j,c in enumerate(confidences) if lo<=c<(hi if i<bins-1 else hi+1e-12)]
        if not idx: continue
        conf=sum(confidences[j] for j in idx)/len(idx)
        acc=sum(bool(correct[j]) for j in idx)/len(idx)
        ece += len(idx)/n*abs(conf-acc)
        rows.append({"lower":lo,"upper":hi,"count":len(idx),"confidence":conf,"accuracy":acc})
    brier=sum((confidences[j]-float(correct[j]))**2 for j in range(n))/n
    return CalibrationReport(ece,brier,rows,n)


def decision_from_confidence(confidence: float, *, answer_threshold: float=.75) -> str:
    if not 0<=confidence<=1:
        raise ValueError("confidence outside [0,1]")
    return "answer" if confidence>=answer_threshold else "retrieve_or_abstain"
