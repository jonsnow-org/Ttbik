"""Data QUALITY (owner decision 2026-11-28: quality over quantity) and the rule for CONTINUING training (no fixed token budget: train until the results are excellent, then the owner decides).

`assess` scores one document with the filters that web-scale corpora use (Gopher / C4 / FineWeb style), with Arabic-specific checks (script ratio, tatweel padding, stray diacritics) and
separate rules for code; every rejection carries a reason, so a filtered corpus can be audited. `plan_mixture` turns what is available into what is trained on (target weights per domain, repeats
capped: the 5th pass over the same Arabic text teaches less than new Arabic text). `Governor` reads the evaluation history and recommends continue / investigate / candidate-to-stop; it NEVER stops or
changes a run itself: stopping is the owner's decision."""
from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass, field

from .evolve import wilson_lower

_AR = re.compile(r"[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]")
_LAT = re.compile(r"[A-Za-z]")
_DIAC = re.compile(r"[ً-ْٰ]")
_WORD = re.compile(r"[^\W_]+(?:['’][^\W_]+)?", re.U)
_HTML = re.compile(r"</?[a-zA-Z][^>]{0,80}>")
_BOILER = re.compile(r"(lorem ipsum|javascript is disabled|enable javascript|cookie policy|accept (all )?cookies|all rights reserved|click here to|subscribe to our newsletter|terms of (use|service)|privacy policy|"
                     r"404 not found|page not found|اشترك في (النشرة|قناتنا)|جميع الحقوق محفوظة|سياسة الخصوصية|اضغط هنا للتسجيل)", re.I)
EN_STOP = {"the", "be", "to", "of", "and", "that", "have", "with", "for", "this", "not", "are", "was", "is", "in", "it", "as", "on", "at", "by", "from"}
AR_STOP = {"في", "من", "على", "إلى", "عن", "أن", "إن", "هذا", "هذه", "ذلك", "التي", "الذي", "كان", "كانت", "ما", "لا", "قد", "مع", "هو", "هي", "أو", "ثم", "كل", "بعد", "عند"}


@dataclass
class Verdict:
    keep: bool
    domain: str
    score: float
    reasons: list[str] = field(default_factory=list)
    features: dict = field(default_factory=dict)


def domain_of(text: str) -> str:
    """arabic | english | code | mixed, from script ratios and code signals."""
    letters = len(_AR.findall(text)) + len(_LAT.findall(text))
    if not letters:
        return "other"
    ar = len(_AR.findall(text)) / letters
    codey = len(re.findall(r"[{};=()<>\[\]]", text)) / max(1, len(text))
    if codey > 0.06 and re.search(r"\b(def|class|import|function|return|const|let|var|public|void|#include|SELECT)\b", text):
        return "code"
    return "arabic" if ar > 0.8 else "english" if ar < 0.1 else "mixed"


def _ngram_top_fraction(words: list[str], n: int) -> float:
    if len(words) < n + 1:
        return 0.0
    grams = Counter(tuple(words[i:i + n]) for i in range(len(words) - n + 1))
    g, c = grams.most_common(1)[0]
    return c * len(g) / len(words)


def _repeated_ngram_coverage(words: list[str], n: int) -> float:
    """Fraction of words covered by an n-gram that occurs more than once (copy-paste spam)."""
    if len(words) < n:
        return 0.0
    grams = [tuple(words[i:i + n]) for i in range(len(words) - n + 1)]
    cnt = Counter(grams)
    covered = [False] * len(words)
    for i, g in enumerate(grams):
        if cnt[g] > 1:
            for j in range(i, i + n):
                covered[j] = True
    return sum(covered) / len(words)


def assess(text: str, domain: str | None = None, min_words: int = 40, max_words: int = 200_000) -> Verdict:
    """Keep or drop one document, with the reasons. Thresholds follow published web-corpus filters; they are deliberately strict (the owner asked for quality over quantity)."""
    dom = domain or domain_of(text)
    words = _WORD.findall(text)
    lines = [ln for ln in text.splitlines() if ln.strip()]
    f: dict = {"words": len(words), "lines": len(lines), "chars": len(text)}
    why: list[str] = []
    if dom == "other":
        return Verdict(False, dom, 0.0, ["no letters"], f)
    if dom == "code":
        long_line = max((len(ln) for ln in lines), default=0)
        alnum = sum(c.isalnum() for c in text) / max(1, len(text))
        f.update(max_line=long_line, alnum=round(alnum, 3))
        if long_line > 1000:
            why.append("a line over 1000 characters (minified or generated)")
        if alnum < 0.25:
            why.append("too few letters and digits for code")
        if len(lines) < 4:
            why.append("fewer than 4 lines")
        if len(set(lines)) / max(1, len(lines)) < 0.5:
            why.append("half the lines are repeated")
        return Verdict(not why, dom, 1.0 if not why else 0.0, why, f)
    if len(words) < min_words:
        why.append(f"fewer than {min_words} words")
    if len(words) > max_words:
        why.append("absurdly long")
    if not words:
        return Verdict(False, dom, 0.0, why, f)
    mean_len = sum(len(w) for w in words) / len(words)
    lo, hi = (2.5, 9.0) if dom == "arabic" else (3.0, 10.0)
    if not lo <= mean_len <= hi:
        why.append(f"mean word length {mean_len:.1f} outside {lo}-{hi}")
    sym = len(re.findall(r"[#…{}\[\]<>|\\^~]", text)) / len(words)
    if sym > 0.1:
        why.append("symbol-to-word ratio above 0.1")
    alpha_words = sum(any(c.isalpha() for c in w) for w in words) / len(words)
    if alpha_words < 0.8:
        why.append("less than 80% of the words contain a letter")
    ell = sum(ln.rstrip().endswith(("...", "…")) for ln in lines) / max(1, len(lines))
    if ell > 0.3:
        why.append("more than 30% of lines end in an ellipsis")
    bullets = sum(bool(re.match(r"\s*([-*•●▪]|\d+[.)])\s", ln)) for ln in lines) / max(1, len(lines))
    if bullets > 0.9:
        why.append("more than 90% of lines are bullets")
    dupl = 1 - len(set(lines)) / max(1, len(lines))
    if dupl > 0.3:
        why.append(f"{dupl:.0%} of lines are duplicates")
    lw = [w.lower() for w in words]
    for n, lim in ((2, 0.20), (3, 0.18), (4, 0.16)):
        t = _ngram_top_fraction(lw, n)
        f[f"top{n}gram"] = round(t, 3)
        if t > lim:
            why.append(f"one {n}-gram makes up {t:.0%} of the text")
    for n, lim in ((5, 0.15), (8, 0.12), (10, 0.10)):
        cov = _repeated_ngram_coverage(lw, n)
        if cov > lim:
            why.append(f"{cov:.0%} of the words sit in repeated {n}-grams")
    uniq = len(set(lw)) / len(lw)
    if len(lw) >= 100 and uniq < 0.2:
        why.append("vocabulary too small for the length")
    stops = AR_STOP if dom == "arabic" else EN_STOP
    hits = len({w for w in lw if w in stops})
    f["stopwords"] = hits
    if dom in ("arabic", "english") and hits < 2:
        why.append("fewer than 2 distinct stop words: not natural prose")
    if _BOILER.search(text):
        why.append("boilerplate (cookies, legal, lorem ipsum, 404)")
    if len(_HTML.findall(text)) > 5:
        why.append("raw HTML tags")
    if dom == "arabic":
        ar_letters = max(1, len(_AR.findall(text)))
        if text.count("ـ") / ar_letters > 0.03:
            why.append("tatweel padding")
        if len(_DIAC.findall(text)) / ar_letters > 0.5:
            why.append("diacritics on more than every other letter (a corrupted or decorative text)")
    score = max(0.0, 1.0 - 0.2 * len(why))
    f.update(mean_word_len=round(mean_len, 2), uniq=round(uniq, 3), dup_lines=round(dupl, 3))
    return Verdict(not why, dom, round(score, 3), why, f)


def filter_corpus(texts: list[str], domain: str | None = None) -> tuple[list[str], dict]:
    """Keep the documents that pass; return a report with the reason counts so the filter itself can be reviewed."""
    kept, reasons, doms = [], Counter(), Counter()
    for t in texts:
        v = assess(t, domain)
        doms[v.domain] += 1
        if v.keep:
            kept.append(t)
        else:
            for r in v.reasons:
                reasons[re.sub(r"[\d.]+%?", "N", r)] += 1
    return kept, {"in": len(texts), "kept": len(kept), "kept_fraction": round(len(kept) / max(1, len(texts)), 3), "by_domain": dict(doms), "reasons": dict(reasons.most_common())}


def plan_mixture(available: dict[str, float], targets: dict[str, float], total: float, max_epochs: float = 4.0) -> dict:
    """What to train on: each domain gets its target share of `total` tokens, but never more than `max_epochs` passes over what exists; the shortfall goes to the other domains in
    proportion to their weights. Returns tokens and epochs per domain, and says when the data cannot honestly fill `total`."""
    if not targets or abs(sum(targets.values()) - 1.0) > 1e-6 or any(w < 0 for w in targets.values()):
        raise ValueError("target weights must be non-negative and sum to 1")
    cap = {d: available.get(d, 0.0) * max_epochs for d in targets}
    take = {d: 0.0 for d in targets}
    free = set(targets)
    left = float(total)
    while left > 1e-9 and free:
        wsum = sum(targets[d] for d in free) or 1.0
        spill = 0.0
        for d in sorted(free):
            want = left * targets[d] / wsum
            room = cap[d] - take[d]
            add = min(want, room)
            take[d] += add
            spill += want - add
        free = {d for d in free if cap[d] - take[d] > 1e-9}
        if abs(spill - left) < 1e-9:
            break
        left = spill
    got = sum(take.values())
    return {"tokens": {d: round(v) for d, v in take.items()}, "epochs": {d: round(take[d] / available[d], 2) if available.get(d) else None for d in targets},
            "filled": round(got), "short_by": round(max(0.0, total - got)), "note": "" if total - got < 1 else "the available data cannot fill the plan within the epoch cap: more data, not more passes"}


@dataclass
class Governor:
    """Reads the evaluation history and RECOMMENDS. `history`: [{step, tokens, metrics: {suite: value or (successes, n)}}], oldest first; a suite is higher-is-better.
    `targets`: {suite: value the owner calls excellent}. Statuses per suite: improving | plateau | regressing | unmeasured | met."""
    targets: dict[str, float]
    window: int = 4
    min_gain: float = 0.01
    regress: float = 0.02

    @staticmethod
    def _value(m) -> float:
        return wilson_lower(int(m[0]), int(m[1])) if isinstance(m, (tuple, list)) else float(m)         # pass-rate suites use the Wilson LOWER bound, never the raw rate

    def assess(self, history: list[dict]) -> dict:
        suites = {}
        for s, target in self.targets.items():
            vals = [self._value(h["metrics"][s]) for h in history if s in h.get("metrics", {})]
            if len(vals) < 2:
                suites[s] = {"status": "unmeasured", "last": vals[-1] if vals else None, "target": target}
                continue
            w = vals[-(self.window + 1):]
            gain = w[-1] - w[0]
            best = max(vals)
            if vals[-1] >= target:
                st = "met"
            elif vals[-1] < best - self.regress:
                st = "regressing"
            elif gain >= self.min_gain:
                st = "improving"
            else:
                st = "plateau"
            suites[s] = {"status": st, "last": round(vals[-1], 4), "best": round(best, 4), "gain_over_window": round(gain, 4), "target": target}
        sts = {v["status"] for v in suites.values()}
        if "regressing" in sts:
            rec, why = "investigate", "a suite fell below its best: check the data batch, the learning rate and contamination before spending more compute"
        elif sts <= {"met"}:
            rec, why = "candidate_to_stop", "every target is met: the owner decides whether to stop or push further"
        elif "improving" in sts:
            rec, why = "continue", "at least one unmet suite is still improving"
        elif "unmeasured" in sts:
            rec, why = "measure", "some suites have fewer than two evaluations"
        else:
            rec, why = "plateau", "no unmet suite is improving: change the DATA (quality, mixture), not just the step count; more compute alone will not help"
        return {"recommendation": rec, "why": why, "suites": suites, "stops_by_itself": False}
