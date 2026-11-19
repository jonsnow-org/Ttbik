#!/usr/bin/env python3
"""Export only fixed Sham 2 source records to deterministic JSONL files.

No random generators, remote datasets, model inference, terminal execution,
or synthetic_examples() helpers are called by this exporter.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Iterable


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _write_jsonl(path: Path, rows: Iterable[dict]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    count = 0
    with tmp.open("w", encoding="utf-8", newline="\n") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
            count += 1
    tmp.replace(path)
    return count


def export(output_dir: Path) -> dict:
    root = _repo_root()
    data_dir = root / "ai-system" / "tldm" / "data"
    sham_dir = root / "ai-system" / "colab" / "sham_small"
    terminal_dir = root / "ai-system" / "terminal"

    # Import only modules that contain the fixed source arrays. We deliberately
    # do not call terminal_tasks.build_jsonl(), rewordings.generate(), or any
    # of sham_tools_data's random/synthetic example builders.
    for path in (str(data_dir), str(sham_dir), str(terminal_dir)):
        if path not in sys.path:
            sys.path.insert(0, path)

    import identity as identity_source
    import terminal_tasks as terminal_source
    import rewordings as rewording_source

    output_dir = output_dir.expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    identity_rows = [
        {"prompt": prompt, "target": target, "stage": "identity"}
        for prompt, target in identity_source.TRAIN
    ]
    terminal_rows = [
        {"prompt": prompt, "target": command, "stage": "tldm_head"}
        for prompt, command in terminal_source.TRAIN
    ]
    terminal_heldout = [
        {"prompt": prompt, "target": command, "source_set": "terminal_tasks.HELDOUT"}
        for prompt, command in terminal_source.HELDOUT
    ]
    rewordings_heldout = [
        {"prompt": prompt, "target": command, "source_set": "rewordings.HELDOUT2"}
        for prompt, command in rewording_source.HELDOUT2
    ]
    identity_heldout_prompts = [
        {"prompt": prompt, "source_set": "identity.HELDOUT", "target_status": "missing"}
        for prompt in identity_source.HELDOUT
    ]

    identity_count = _write_jsonl(output_dir / "identity.jsonl", identity_rows)
    terminal_count = _write_jsonl(output_dir / "terminal_tasks.jsonl", terminal_rows)
    train_count = _write_jsonl(
        output_dir / "train.jsonl", identity_rows + terminal_rows
    )
    heldout_count = _write_jsonl(
        output_dir / "heldout.jsonl", terminal_heldout + rewordings_heldout
    )
    identity_prompt_count = _write_jsonl(
        output_dir / "identity_heldout_prompts.jsonl", identity_heldout_prompts
    )

    # sham_tools_data.py has a mixture of template/catalog fixtures and
    # stochastic synthetic generators, not a fixed, verified real-tool trace
    # corpus suitable for claiming a real tools training set.
    # General Arabic sources are currently remote-streamed by sham_v2_train.py
    # (CIDAR / Aya) rather than committed as a fixed local dataset. The small
    # identity answers are not a substitute for general Arabic supervision.
    manifest = {
        "format": "sham2-jsonl-source-manifest-v1",
        "schema": {
            "training_line": {
                "prompt": "string",
                "target": "string",
                "stage": "identity|tldm_head",
            },
            "heldout_line": {
                "prompt": "string",
                "target": "string",
                "source_set": "terminal_tasks.HELDOUT|rewordings.HELDOUT2",
            },
        },
        "output_dir": str(output_dir),
        "files": {
            "identity.jsonl": {"rows": identity_count, "source": "ai-system/tldm/data/identity.py:TRAIN"},
            "terminal_tasks.jsonl": {"rows": terminal_count, "source": "ai-system/tldm/data/terminal_tasks.py:TRAIN"},
            "train.jsonl": {"rows": train_count, "contains_stages": ["identity", "tldm_head"]},
            "heldout.jsonl": {
                "rows": heldout_count,
                "source_sets": {
                    "terminal_tasks.HELDOUT": len(terminal_heldout),
                    "rewordings.HELDOUT2": len(rewordings_heldout),
                },
            },
            "identity_heldout_prompts.jsonl": {
                "rows": identity_prompt_count,
                "source": "ai-system/tldm/data/identity.py:HELDOUT",
                "usable_as_supervised_heldout": False,
                "reason": "The source contains prompts only and no reference targets; no answers were invented.",
            },
        },
        "stages": {
            "identity": {
                "status": "available",
                "source": "ai-system/tldm/data/identity.py:TRAIN",
                "rows": identity_count,
            },
            "tldm_head": {
                "status": "available",
                "source": "ai-system/tldm/data/terminal_tasks.py:TRAIN",
                "rows": terminal_count,
            },
            "tools": {
                "status": "missing",
                "source_checked": "ai-system/colab/sham_small/sham_tools_data.py",
                "reason": (
                    "The file contains catalog/template fixtures and stochastic synthetic example builders, "
                    "but no fixed verified real-tool trace dataset. It was not exported or randomized."
                ),
            },
            "arabic": {
                "status": "missing",
                "source_checked": "ai-system/colab/sham_small/sham_v2_train.py:arabic_replay_pairs",
                "reason": (
                    "General Arabic pairs are streamed from external datasets (CIDAR/Aya) and are not committed "
                    "as a fixed local corpus. Identity examples are narrow identity supervision, not a general Arabic dataset."
                ),
            },
        },
        "missing_required_stages": ["tools", "arabic"],
        "random_generation_used": False,
        "remote_dataset_download_used": False,
        "training_performed": False,
        "gate_performed": False,
    }
    manifest_path = output_dir / "manifest.json"
    tmp_manifest = manifest_path.with_suffix(".json.tmp")
    tmp_manifest.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    tmp_manifest.replace(manifest_path)
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Export the fixed Sham 2 GitHub source arrays to JSONL; no random synthesis."
    )
    parser.add_argument("--out", required=True, help="Output directory for the exported JSONL files")
    args = parser.parse_args()
    result = export(Path(args.out))
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
