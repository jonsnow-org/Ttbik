"""Argument slots (2026-11-18): copy names/numbers from the task by de-lexicalization (cfg `delex: true`).

  delex(task, cmd=None) -> (task', cmd', slots): file names and numbers of the task become @F1.. / @N1..; the same values in the command become the same slots,
                            so the writer learns to COPY an argument it has never seen (the 0/8 unseen-name failure) instead of writing a remembered name.
  relex(cmd', slots)       -> the real command.
Measured 2026-11-18 (docs/experiments/tldm_heldout_gate_2026-11-18.json): slots lift the agent loop on unseen names; on the single-command writer neither slots,
random-name rows nor WordNet synonyms helped (dropped from the trainer); the frozen pretrained reader did."""
from __future__ import annotations

import re

FILE = re.compile(r"(?<![\w@])[\w-]+\.(?:txt|md|log|py|jpg|png|csv|json)\b")
NUM = re.compile(r"(?<![\w@.])\d+(?![\w.])")
# 2026-11-22 (open arguments): a GitHub repository `owner/name` (R) and a code-like token such as ZX7Q-4821 (T) are copied like file names and numbers:
# the task may name any of them and the writer has never seen it. Neither pattern matches a single row of the old training/held-out sets (tested).
REPO = re.compile(r"(?<![\w@/.:-])[A-Za-z][\w.-]{1,38}/[A-Za-z][\w.-]{1,38}(?![\w/])")
TOKEN = re.compile(r"(?<![\w@-])(?=[A-Z0-9-]*[A-Z])(?=[A-Z0-9-]*\d)[A-Z0-9]{2,}(?:-[A-Z0-9]{2,})+(?![\w-])")


def delex(task: str, cmd: str | None = None):
    slots, out = {}, task
    for kind, pat in (("R", REPO), ("T", TOKEN), ("F", FILE), ("N", NUM)):
        for v in pat.findall(out):
            if v not in slots.values():
                slots[f"@{kind}{sum(k.startswith('@' + kind) for k in slots) + 1}"] = v
        for k, v in slots.items():
            if k.startswith("@" + kind):
                out = re.sub(rf"(?<![\w@.]){re.escape(v)}(?![\w])", k, out)
    return out, (None if cmd is None else apply_slots(cmd, slots)), slots


def apply_slots(text: str, slots: dict) -> str:
    """The task's argument values inside another text (a command, a terminal result, a reply) become their slots."""
    for k, v in sorted(slots.items(), key=lambda kv: -len(kv[1])):
        text = re.sub(rf"(?<![\w@.]){re.escape(v)}(?![\w])", k, text)
    return text


def relex(cmd: str, slots: dict) -> str:
    for k in sorted(slots, key=len, reverse=True):
        cmd = cmd.replace(k, slots[k])
    return cmd
