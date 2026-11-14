"""Narrated-video planning for Sham: from a script to timed shots and subtitle cues — pure Python, no model, no network.

Ideas adopted from the MIT-licensed MoneyPrinterTurbo (harry0703/MoneyPrinterTurbo), re-built for Sham's own generators (nothing external is called):
  * the script is cleaned before it is spoken (markdown, bracketed stage directions and links are not narration);
  * the script is split into sentences, each sentence is one shot, and a shot lasts as long as its own spoken audio (that project's `_get_required_video_duration`);
  * subtitle cues come from the sentence timings. That project transcribes the speech back with Whisper and then repairs the text against the script; Sham makes the
    audio itself, so it already knows every sentence's start and end and needs neither Whisper nor the repair step;
  * long sentences are broken into short subtitle lines at word boundaries, never inside a word.
Arabic-aware: it splits at ؟ ، ؛ and ۔ as well as . ! ? and keeps tashkeel and the Arabic digits as they are. Drawing shaped Arabic glyphs is the renderer's job, not this module's.
"""
from __future__ import annotations

import re

_SENT_END = "。.!?؟!؟…"
_CLAUSE = "،؛,;:"


def clean_script(text: str) -> str:
    """Narration text: no markdown emphasis or headings, links keep their label, [stage directions] and (asides) are dropped, spaces are tidied."""
    t = str(text or "").replace("\r", "")
    t = t.replace("*", "").replace("`", "")
    t = re.sub(r"(?m)^[ \t]{0,3}#{1,6}[ \t]+(.*?)[ \t]*#*[ \t]*$", r"\1", t)
    t = re.sub(r"\[([^\]\n]+)\]\((?:[^()\n]|\([^()\n]*\))*\)", r"\1", t)         # [label](url) -> label
    t = re.sub(r"\[[^\]\n]*\]", "", t)                                           # [stage direction]
    t = re.sub(r"\([^()\n]*\)", "", t)                                           # (aside)
    t = re.sub(r"(?m)^[ \t]*[-•▪]+[ \t]+", "", t)                                # list bullets
    t = re.sub(r"[ \t]+", " ", t)
    t = re.sub(r"[ \t]*\n[ \t]*", "\n", t)
    return re.sub(r"\n{3,}", "\n\n", t).strip()


def split_sentences(text: str) -> list[str]:
    """Sentences in order; a blank line always ends one. Terminal marks stay attached to their sentence."""
    out: list[str] = []
    for para in re.split(r"\n\s*\n|\n", clean_script(text)):
        buf = ""
        for ch in para:
            buf += ch
            if ch in _SENT_END and not re.fullmatch(r"\d+\.", buf.strip()):      # '3.' of a numbered list is not a sentence
                s = buf.strip()
                if s:
                    out.append(s)
                buf = ""
        if buf.strip():
            out.append(buf.strip())
    return [s for s in out if re.search(r"\w", s)]


def plan_shots(script: str, durations: list[float], min_seconds: float = 1.5, max_seconds: float = 12.0) -> list[dict]:
    """One shot per sentence. `durations[i]` is the length of sentence i's own audio; a shot is never shorter than `min_seconds` (a too-short sentence is merged
    into the next one) nor longer than `max_seconds` (a long one is split at a clause mark). Returns [{text, start, end, seconds}] on one continuous timeline."""
    sentences = split_sentences(script)
    if len(durations) != len(sentences):
        raise ValueError(f"{len(sentences)} sentences but {len(durations)} audio durations")
    items = [(s, max(0.0, float(d))) for s, d in zip(sentences, durations)]
    merged: list[tuple[str, float]] = []
    carry_t, carry_d = "", 0.0
    for s, d in items:
        text, dur = (carry_t + " " + s).strip(), carry_d + d
        if dur < min_seconds:
            carry_t, carry_d = text, dur
            continue
        merged.append((text, dur))
        carry_t, carry_d = "", 0.0
    if carry_t:
        if merged:
            merged[-1] = ((merged[-1][0] + " " + carry_t).strip(), merged[-1][1] + carry_d)
        else:
            merged.append((carry_t, carry_d))
    shots: list[dict] = []
    t0 = 0.0
    for text, dur in merged:
        for piece, pdur in _split_long(text, dur, max_seconds):
            shots.append({"text": piece, "start": round(t0, 3), "end": round(t0 + pdur, 3), "seconds": round(pdur, 3)})
            t0 += pdur
    return shots


def _split_long(text: str, dur: float, max_seconds: float) -> list[tuple[str, float]]:
    if dur <= max_seconds:
        return [(text, dur)]
    parts = [p.strip() for p in re.split(rf"(?<=[{re.escape(_CLAUSE)}])\s+", text) if p.strip()]
    if len(parts) < 2:
        parts = text.split()                                                       # no clause mark: words (still never inside a word)
    n_chunks = max(2, int(dur // max_seconds) + (1 if dur % max_seconds else 0))
    total = sum(len(p) for p in parts) or 1
    chunks: list[list[str]] = [[] for _ in range(n_chunks)]
    acc, idx = 0, 0
    for p in parts:
        chunks[min(idx, n_chunks - 1)].append(p)
        acc += len(p)
        if acc >= total * (idx + 1) / n_chunks:
            idx += 1
    chunks = [c for c in chunks if c]
    sizes = [sum(len(p) for p in c) or 1 for c in chunks]
    return [(" ".join(c), dur * sz / sum(sizes)) for c, sz in zip(chunks, sizes)]


def wrap_lines(text: str, max_chars: int = 28, max_lines: int = 2) -> list[str]:
    """Break a cue into at most `max_lines` lines of about `max_chars`, at word boundaries only. Text that cannot fit is returned in further lines (use split_cue to turn those into more cues)."""
    words, lines, cur = text.split(), [], ""
    for w in words:
        if cur and len(cur) + 1 + len(w) > max_chars:
            lines.append(cur)
            cur = w
        else:
            cur = (cur + " " + w).strip()
    if cur:
        lines.append(cur)
    return lines


def subtitle_cues(shots: list[dict], max_chars: int = 28, max_lines: int = 2) -> list[dict]:
    """Timed cues from the shots: a shot whose text needs more than `max_lines` lines is divided into several cues in proportion to their length."""
    cues: list[dict] = []
    for sh in shots:
        lines = wrap_lines(sh["text"], max_chars, max_lines)
        groups = [lines[i:i + max_lines] for i in range(0, len(lines), max_lines)] or [[]]
        sizes = [sum(len(x) for x in g) or 1 for g in groups]
        t = sh["start"]
        span = sh["end"] - sh["start"]
        for g, sz in zip(groups, sizes):
            d = span * sz / sum(sizes)
            cues.append({"start": round(t, 3), "end": round(t + d, 3), "lines": g})
            t += d
    return cues


def _ts(sec: float) -> str:
    ms = int(round(sec * 1000))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


def to_srt(cues: list[dict]) -> str:
    return "".join(f"{i}\n{_ts(c['start'])} --> {_ts(c['end'])}\n" + "\n".join(c["lines"]) + "\n\n" for i, c in enumerate(cues, 1))


def shot_prompts(shots: list[dict], style: str = "") -> list[str]:
    """The visual prompt of each shot: its sentence (the model that writes the script can also write richer prompts; this is the plain fallback), with an optional shared style
    phrase so all shots of one video look alike."""
    return [(sh["text"] + (f"، {style}" if style else "")).strip() for sh in shots]
