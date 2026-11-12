#!/usr/bin/env python3
"""Stream public Hugging Face datasets into SIL-compatible JSONL.

This importer is deliberately read-only with respect to source repositories. It
never launches a model, calls a teacher API, starts training, or edits Sham files.
Install optional dependency: pip install datasets

Teacher rows are always marked unreviewed and must pass the SIL review/quarantine
workflow before they can enter a training split. Separate reasoning/thinking fields
are deliberately not exported; only visible user/assistant content and final outputs
are used.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any

SOURCES = {
    "jais3_cc": ("IFM/Jais-3-Data", "arabic-txt360-cc", "raw"),
    "jais3_qa": ("IFM/Jais-3-Data", "arabic-cc-qa", "teacher"),
    "jais3_sft": ("IFM/Jais-3-Data", "arabic-txt360-3efforts-sft", "teacher"),
    "clusterlab_arabic": ("ClusterlabAi/101_billion_arabic_words_dataset", "default", "raw"),
    "arabictext_large": ("Jr23xd23/ArabicText-Large", "default", "raw"),
    "aya_human": ("CohereLabs/aya_dataset", "default", "natural"),
    "aya_collection_config": ("CohereLabs/aya_collection_language_split", None, "auto"),
    "arabic_openhermes": ("2A2I/Arabic-OpenHermes-2.5", "default", "teacher"),
    "tiny_aya_arabic": ("CohereLabs/tiny-aya-l2-thinker-multilingual-reasoning", "ar", "teacher"),
    "openr1_math": ("open-r1/OpenR1-Math-220k", "all", "teacher"),
    "mixture_of_thoughts": ("open-r1/Mixture-of-Thoughts", "all", "teacher"),
    "ultrachat": ("HuggingFaceH4/ultrachat_200k", "default", "teacher"),
    "openhermes": ("teknium/OpenHermes-2.5", "default", "teacher"),
    "smollm_raw": ("HuggingFaceTB/smollm-corpus", "cosmopedia-v2", "raw"),
    "fineweb_edu_raw": ("HuggingFaceFW/fineweb-edu", "default", "raw"),
    "cosmopedia_raw": ("HuggingFaceTB/cosmopedia", "stories", "raw"),
}
ARABIC_CODES = {"ar", "ara", "arb", "arz", "ary", "ars", "acq", "apc", "aeb", "ajp", "acm", "knc"}


def _jsonable(value: Any) -> Any:
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    return str(value)


def _stable_id(*parts: str) -> str:
    return hashlib.sha256("\x1f".join(str(p) for p in parts).encode("utf-8")).hexdigest()


def _text(row: dict, *keys: str) -> str:
    for key in keys:
        value = row.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _teacher_record(prompt: str, target: str, *, teacher_id: str, source_id: str,
                    task: str = "distilled_sft", metadata: dict | None = None,
                    language: str = "ar", difficulty: int = 2) -> dict | None:
    if not prompt.strip() or not target.strip():
        return None
    return {
        "prompt": prompt.strip(), "target": target.strip(), "task": task,
        "teacher_id": teacher_id, "difficulty": max(1, min(5, difficulty)),
        "metadata": {
            "source_id": source_id, "reviewed": False, "verification_status": "pending",
            "teacher_output_is_unverified": True, "language": language,
            **(metadata or {}),
        },
    }


def _natural_record(prompt: str, target: str, *, source_id: str, metadata: dict | None = None,
                    language: str = "ar") -> dict | None:
    if not prompt.strip() or not target.strip():
        return None
    return {
        "prompt": prompt.strip(), "target": target.strip(), "task": "natural_sft",
        "source_kind": "natural", "language": language, "difficulty": 1,
        "verifier": "none", "source_id": source_id, "split_group": source_id,
        "metadata": {"review_status": "unreviewed_import", **(metadata or {})},
    }


def _messages(value: Any) -> list[dict]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except Exception:
            return []
    if not isinstance(value, list):
        return []
    result = []
    for item in value:
        if not isinstance(item, dict):
            continue
        role = _text(item, "role", "from", "speaker").lower()
        content = _text(item, "content", "value", "text")
        # Do not copy separate private/deliberation trace fields.
        if not content:
            continue
        role_map = {"human": "user", "gpt": "assistant", "bot": "assistant"}
        result.append({"role": role_map.get(role, role), "content": content})
    return result


def _strip_think(text: str) -> str:
    # Keep only the final answer after a closed <think> region. Unclosed traces are
    # rejected rather than copied into a training target.
    if "<think>" in text.lower():
        match = re.search(r"(?is)</think>\s*(.*)$", text)
        if not match:
            return ""
        text = match.group(1)
    text = re.sub(r"(?is)</?analysis>|</?final>|</?think>", "", text)
    return text.strip()


def _conversation_records(messages: list[dict], *, teacher_id: str, source_id: str,
                           metadata: dict | None = None, language: str = "en") -> list[dict]:
    rows = []
    history = []
    last_user = None
    for message in messages:
        role, content = message["role"], message["content"]
        if role == "user":
            last_user = content
            history.append((role, content))
        elif role == "assistant":
            answer = _strip_think(content)
            if answer and last_user:
                prompt = "\n".join(f"{r}: {c}" for r, c in history)
                record = _teacher_record(prompt, answer, teacher_id=teacher_id,
                    source_id=source_id, metadata=metadata, language=language)
                if record:
                    rows.append(record)
            history.append((role, answer or "[assistant turn omitted: no final answer available]"))
            last_user = None
    return rows


def convert_row(source: str, row: dict, index: int, config: str) -> list[dict]:
    repo = SOURCES[source][0]
    sid = f"{repo}:{config}:train:{index}"
    meta = {"source_dataset": repo, "source_config": config, "source_split": "train", "source_row": index}

    if source in {"jais3_cc", "clusterlab_arabic", "arabictext_large", "smollm_raw", "fineweb_edu_raw", "cosmopedia_raw"}:
        text_value = _text(row, "text", "content", "document", "article", "body", "raw")
        if not text_value:
            candidates = [v for v in row.values() if isinstance(v, str) and len(v.strip()) > 150]
            text_value = max(candidates, key=len) if candidates else ""
        if not text_value:
            return []
        return [{"record_id": _stable_id(sid, text_value[:500]), "record_type": "raw_corpus",
                 "source_kind": "synthetic_corpus" if source in {"cosmopedia_raw", "smollm_raw"} else "corpus_candidate",
                 "text": text_value, "source_dataset": repo, "source_config": config,
                 "source_split": "train", "source_row": index,
                 "source_metadata": _jsonable({k: v for k, v in row.items() if k not in {"text", "content", "document", "article", "body", "raw"}}),
                 "origin_review_required": True}]

    if source == "aya_human":
        code = _text(row, "language_code", "language").lower()
        if code not in ARABIC_CODES and not code.startswith("arabic") and "arabic" not in code:
            return []
        prompt, target = _text(row, "inputs", "prompt", "instruction"), _text(row, "targets", "target", "response")
        rec = _natural_record(prompt, target, source_id=sid,
            metadata={**meta, "annotation_type": row.get("annotation_type"), "language_code": code})
        return [rec] if rec else []

    if source == "aya_collection_config":
        # This collection mixes translated, templated and task-specific data. Do not
        # auto-label it as human-natural or teacher output; keep it for classification.
        prompt = _text(row, "inputs", "prompt", "instruction", "question", "source_text")
        target = _text(row, "targets", "target", "response", "output", "translation")
        if not prompt or not target:
            return []
        return [{"record_id": _stable_id(sid, prompt, target), "record_type": "review_required_pair",
                 "source_kind": "unclassified", "prompt": prompt, "target": target,
                 "source_dataset": repo, "source_config": config, "source_split": "train",
                 "source_row": index, "source_metadata": _jsonable({k: v for k, v in row.items() if k not in {"inputs", "prompt", "instruction", "question", "source_text", "targets", "target", "response", "output", "translation"}}),
                 "review_status": "classification_required_before_sft"}]

    if source == "arabic_openhermes":
        prompt, target = _text(row, "user", "prompt", "instruction"), _text(row, "gpt", "assistant", "response")
        if not prompt or not target:
            messages = _messages(row.get("conversations"))
            return _conversation_records(messages, teacher_id=f"dataset:{repo}", source_id=sid, metadata=meta, language="ar")
        rec = _teacher_record(prompt, target, teacher_id=f"dataset:{repo}", source_id=sid,
            metadata={**meta, "source_fields": ["user", "gpt"]}, language="ar")
        return [rec] if rec else []

    if source == "tiny_aya_arabic":
        prompt, target = _text(row, "question"), _text(row, "output")
        rec = _teacher_record(prompt, target,
            teacher_id="gpt-oss-120b (dataset-attributed; translated output)", source_id=sid,
            metadata={**meta, "teacher_model_attribution": "gpt-oss-120b", "translation_models_attributed": ["command-a-translate", "DeepSeek-V3"], "thinking_field_excluded": True},
            language="ar", task="reasoning")
        return [rec] if rec else []

    if source == "jais3_sft":
        messages = _messages(row.get("messages"))
        category = _text(row, "category")
        rows = _conversation_records(messages, teacher_id=f"dataset:{repo}:{config}", source_id=sid,
            metadata={**meta, "category": category, "conv_index": row.get("conv_index"),
                      "token_count": row.get("token_count"), "separate_thinking_fields_excluded": True}, language="ar")
        return rows[-1:]  # keep the final aligned exchange from each source conversation

    if source == "jais3_qa":
        full_text = _text(row, "text")
        match = re.search(r"(?is)\bQuestion\s*:\s*(.*?)\s*\bAnswer\s*:\s*(.*)$", full_text)
        if not match:
            return []
        question, answer = match.group(1).strip(), match.group(2).strip()
        context = full_text[:match.start()].strip()
        prompt = f"اعتماداً على النص التالي فقط، أجب عن السؤال.\nالنص:\n{context}\nالسؤال: {question}" if context else question
        raw_meta = row.get("meta") if isinstance(row.get("meta"), dict) else {}
        rec = _teacher_record(prompt, answer, teacher_id=f"dataset:{repo}:{config}", source_id=sid,
            task="evidence", metadata={**meta, "source_url": raw_meta.get("url"),
            "detected_language": raw_meta.get("detected_language"), "token_count": row.get("token_count")}, language="ar")
        return [rec] if rec else []

    if source == "openr1_math":
        prompt, answer = _text(row, "problem"), _text(row, "answer")
        rec = _teacher_record(prompt, answer, teacher_id="DeepSeek-R1 (dataset-attributed)", source_id=sid,
            task="reasoning", metadata={**meta, "solution_trace_available_but_not_exported": bool(row.get("solution")),
            "verifier_metadata": _jsonable({k: row.get(k) for k in ("correctness_math_verify", "correctness_llama", "correctness_count") if k in row})}, language="en", difficulty=4)
        return [rec] if rec else []

    if source == "mixture_of_thoughts":
        messages = _messages(row.get("messages"))
        return _conversation_records(messages, teacher_id="DeepSeek-R1 (dataset-attributed)", source_id=sid,
            metadata={**meta, "num_tokens": row.get("num_tokens"), "think_trace_excluded": True}, language="en")[-1:]

    if source == "ultrachat":
        messages = _messages(row.get("messages"))
        return _conversation_records(messages, teacher_id="ChatGPT (dataset-attributed)", source_id=sid,
            metadata={**meta, "prompt_id": row.get("prompt_id")}, language="en")

    if source == "openhermes":
        messages = _messages(row.get("conversations"))
        return _conversation_records(messages, teacher_id="OpenHermes-2.5 dataset (mixed teacher sources)", source_id=sid,
            metadata={**meta, "model_name": row.get("model_name"), "source_label": row.get("source")}, language="en")

    return []


def stream_import(source: str, output: str, *, max_records: int = 1000,
                  config_override: str | None = None, split: str = "train") -> dict:
    try:
        from datasets import load_dataset
    except ImportError as exc:
        raise SystemExit("Missing optional dependency. Run: pip install datasets") from exc

    repo, default_config, kind = SOURCES[source]
    config = config_override or default_config
    if source == "aya_collection_config" and not config:
        raise ValueError("aya_collection_config requires --config, e.g. standard_arabic or north_levantine_arabic")
    if kind == "auto":
        kind = "review_required"
    dataset = load_dataset(repo, config, split=split, streaming=True)
    destination = Path(output)
    destination.parent.mkdir(parents=True, exist_ok=True)
    seen = imported = emitted = skipped = 0
    with destination.open("w", encoding="utf-8") as stream:
        for row in dataset:
            if max_records > 0 and seen >= max_records:
                break
            index = seen
            seen += 1
            try:
                records = convert_row(source, dict(row), index, config or "default")
            except Exception:
                skipped += 1
                continue
            for record in records:
                stream.write(json.dumps(_jsonable(record), ensure_ascii=False, sort_keys=True) + "\n")
                emitted += 1
                imported += 1
    report = {"source": source, "repo": repo, "config": config, "split": split,
              "rows_scanned": seen, "records_written": emitted, "rows_skipped_or_filtered": max(0, seen-imported),
              "output": str(destination), "record_kind": kind,
              "note": "This is an import extract, not an approval to train. Review provenance, duplicates, quality, and task mapping separately."}
    report_path = destination.with_suffix(destination.suffix + ".report.json")
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, choices=sorted(SOURCES))
    parser.add_argument("--output", required=True, help="Destination JSONL path")
    parser.add_argument("--max-records", type=int, default=1000,
                        help="Maximum source rows to scan; use 0 to stream the entire split")
    parser.add_argument("--config", help="Override source config; required for aya_collection_config")
    parser.add_argument("--split", default="train")
    args = parser.parse_args()
    report = stream_import(args.source, args.output, max_records=args.max_records,
                           config_override=args.config, split=args.split)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
