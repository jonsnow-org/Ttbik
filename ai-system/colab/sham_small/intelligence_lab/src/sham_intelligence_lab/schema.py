"""Versioned, standalone dataset contracts for Sham Intelligence Lab.

This package deliberately has no imports from Sham's production/runtime code.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from hashlib import sha256
import json
import re
from typing import Any, Literal

SCHEMA_VERSION = "sil-1.0"
TaskKind = Literal[
    "natural_sft", "distilled_sft", "reasoning", "evidence", "uncertainty",
    "tool_judgement", "repair", "preference"
]


def canonical_text(value: str) -> str:
    value = value.replace("\r\n", "\n").replace("\r", "\n")
    value = re.sub(r"\s+", " ", value).strip()
    return value


def stable_id(*parts: str) -> str:
    payload = "\x1f".join(canonical_text(p) for p in parts)
    return sha256(payload.encode("utf-8")).hexdigest()


@dataclass(slots=True)
class Evidence:
    source_id: str
    text: str
    title: str = ""
    locator: str = ""
    license: str = "unknown"
    start: int | None = None
    end: int | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def validate(self) -> None:
        if not self.source_id.strip() or not self.text.strip():
            raise ValueError("Evidence requires non-empty source_id and text")
        if (self.start is None) != (self.end is None):
            raise ValueError("Evidence start/end must either both be set or both be absent")
        if self.start is not None and (self.start < 0 or self.end < self.start):
            raise ValueError("Invalid evidence offsets")


@dataclass(slots=True)
class Example:
    prompt: str
    target: str
    task: TaskKind
    source_kind: Literal["natural", "synthetic", "teacher"]
    language: str = "ar"
    difficulty: int = 1
    verifier: str = "none"
    verification: dict[str, Any] = field(default_factory=dict)
    evidence: list[Evidence] = field(default_factory=list)
    explanation: str = ""  # concise, checkable solution summary; never private chain-of-thought
    confidence_label: Literal["high", "medium", "low", "abstain"] | None = None
    source_id: str = ""
    parent_ids: list[str] = field(default_factory=list)
    split_group: str = ""
    sample_id: str = ""
    schema_version: str = SCHEMA_VERSION
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.sample_id:
            self.sample_id = stable_id(self.task, self.prompt, self.target)
        if not self.split_group:
            self.split_group = self.source_id or self.sample_id

    def validate(self) -> None:
        if self.task not in {"natural_sft", "distilled_sft", "reasoning", "evidence", "uncertainty", "tool_judgement", "repair", "preference"}:
            raise ValueError(f"Unsupported task: {self.task}")
        if self.source_kind not in {"natural", "synthetic", "teacher"}:
            raise ValueError(f"Unsupported source_kind: {self.source_kind}")
        if not self.sample_id or not self.split_group:
            raise ValueError("sample_id and split_group must be non-empty")
        if self.schema_version != SCHEMA_VERSION:
            raise ValueError(f"Unsupported schema_version: {self.schema_version}")
        if not self.prompt.strip() or not self.target.strip():
            raise ValueError("prompt and target must be non-empty")
        if not 1 <= self.difficulty <= 5:
            raise ValueError("difficulty must be in [1, 5]")
        if self.source_kind == "teacher" and not self.source_id:
            raise ValueError("teacher examples require source_id / teacher lineage")
        for item in self.evidence:
            item.validate()
        expected = stable_id(self.task, self.prompt, self.target)
        if self.sample_id != expected:
            raise ValueError("sample_id does not match canonical content")

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "Example":
        value = dict(raw)
        value["evidence"] = [Evidence(**e) for e in value.get("evidence", [])]
        obj = cls(**value)
        obj.validate()
        return obj

    def to_jsonl(self) -> str:
        self.validate()
        return json.dumps(self.to_dict(), ensure_ascii=False, sort_keys=True)


def example_from_teacher(
    *, prompt: str, target: str, task: TaskKind, teacher_id: str,
    explanation: str = "", confidence: float | None = None,
    parent_ids: list[str] | None = None, metadata: dict[str, Any] | None = None,
    verifier: str = "none", verification: dict[str, Any] | None = None, difficulty: int = 2,
) -> Example:
    """Normalize an externally supplied teacher answer; does not call a teacher."""
    if not teacher_id.strip():
        raise ValueError("teacher_id is required for provenance")
    if confidence is not None and not 0.0 <= confidence <= 1.0:
        raise ValueError("confidence must be between 0 and 1")
    return Example(
        prompt=prompt, target=target, task=task, source_kind="teacher",
        source_id=f"teacher:{teacher_id}", explanation=explanation,
        parent_ids=list(parent_ids or []), difficulty=difficulty, verifier=verifier,
        verification=dict(verification or {}),
        metadata={**(metadata or {}), "teacher_confidence": confidence,
                  "teacher_id": teacher_id, "teacher_output_is_unverified": not ((metadata or {}).get("reviewed") is True and (metadata or {}).get("verification_status") == "passed")},
    )
