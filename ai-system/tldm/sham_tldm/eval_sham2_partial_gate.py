#!/usr/bin/env python3
"""Fresh, isolated gate for the Sham 2 partial identity+terminal artifact.

Only terminal_tasks.HELDOUT (12 rows) and rewordings.HELDOUT2 (14 rows)
are evaluated. The 2026-11-18 writer-donor result is never read.
Every predicted command is checked inside the repository's restricted
SandboxTerminal fixture; no command runs on the host shell.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import torch
import torch.nn.functional as F


def tldm_root() -> Path:
    """T-LDM root in both the Git checkout and the staged ModelScope Studio layout."""
    candidate = Path(__file__).resolve().parents[1]
    if (candidate / "data" / "terminal_tasks.py").is_file():
        return candidate
    raise FileNotFoundError("T-LDM data tree is missing terminal_tasks.py")


def read_jsonl(path: Path) -> list[dict]:
    rows: list[dict] = []
    with path.open("r", encoding="utf-8") as stream:
        for line_no, line in enumerate(stream, 1):
            if not line.strip():
                continue
            value = json.loads(line)
            if not isinstance(value, dict):
                raise ValueError(f"{path}:{line_no}: expected a JSON object")
            for field in ("prompt", "target", "source_set"):
                if not isinstance(value.get(field), str) or not value[field].strip():
                    raise ValueError(f"{path}:{line_no}: missing {field}")
            rows.append(value)
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Evaluate only the new Sham 2 partial head on the two frozen terminal held-outs."
    )
    parser.add_argument("--data-dir", required=True)
    parser.add_argument("--heads", required=True)
    parser.add_argument("--donor", default="novaai2026/sham-v2")
    parser.add_argument("--tokenizer", default="novaai2026/sham-v2")
    parser.add_argument("--minimum-same-effect", type=float, default=0.60)
    parser.add_argument("--seed", type=int, default=20261119)
    parser.add_argument("--report", required=True)
    parser.add_argument("--expected-donor-sha256", default=None,
                        help="require the donor checkpoint SHA-256 from the compatible Studio preflight")
    args = parser.parse_args()

    tldm = tldm_root()
    data_dir = Path(args.data_dir).expanduser().resolve()
    manifest = json.loads((data_dir / "manifest.json").read_text(encoding="utf-8"))
    files = manifest.get("files") or {}
    if files.get("terminal_heldout.jsonl", {}).get("rows") != 12:
        raise ValueError("manifest must declare exactly 12 terminal_heldout rows")
    if files.get("heldout2.jsonl", {}).get("rows") != 14:
        raise ValueError("manifest must declare exactly 14 heldout2 rows")
    if manifest.get("training", {}).get("status") != "partial, not full":
        raise ValueError("the data manifest is not labelled partial, not full")
    if (manifest.get("stages") or {}).get("tools", {}).get("status") != "missing":
        raise ValueError("tools must remain missing in this partial gate")
    if (manifest.get("stages") or {}).get("arabic", {}).get("status") != "missing":
        raise ValueError("arabic must remain missing in this partial gate")

    terminal_rows = read_jsonl(data_dir / "terminal_heldout.jsonl")
    reworded_rows = read_jsonl(data_dir / "heldout2.jsonl")
    if len(terminal_rows) != 12 or len(reworded_rows) != 14:
        raise ValueError(
            f"held-out inventory mismatch: terminal={len(terminal_rows)}, rewordings={len(reworded_rows)}"
        )
    if any(row["source_set"] != "terminal_tasks.HELDOUT" for row in terminal_rows):
        raise ValueError("terminal_heldout.jsonl contains a row from the wrong source set")
    if any(row["source_set"] != "rewordings.HELDOUT2" for row in reworded_rows):
        raise ValueError("heldout2.jsonl contains a row from the wrong source set")
    rows = terminal_rows + reworded_rows

    sys.path.insert(0, str(tldm / "sham_tldm"))
    sys.path.insert(0, str(tldm / "data"))
    import terminal_tasks as terminal_source
    from sham2_unified import (
        Sham2Unified,
        Sham2UnifiedConfig,
        file_sha256,
        encode_target_bytes,
        decode_target_bytes,
        BYTE_VOCAB,
        install_rank16_lora,
        load_sham2_heads,
        load_sham_donor,
        load_sham_tokenizer,
        resolve_modelscope_inputs,
        _model_donor_config,
    )

    donor_path, tokenizer_path = resolve_modelscope_inputs(args.donor, args.tokenizer)
    actual_donor_sha256 = file_sha256(donor_path)
    if args.expected_donor_sha256 and actual_donor_sha256.lower() != args.expected_donor_sha256.strip().lower():
        raise ValueError(
            "donor SHA-256 changed after the compatible preflight: "
            f"expected {args.expected_donor_sha256}, got {actual_donor_sha256}"
        )
    tokenizer = load_sham_tokenizer(str(tokenizer_path))
    donor_body, _donor_step, _donor_extra = load_sham_donor(str(donor_path))
    donor_cfg = _model_donor_config(donor_body)
    cfg = Sham2UnifiedConfig(
        donor_id=str(args.donor),
        d_model=donor_cfg["d_model"],
        vocab_size=donor_cfg["vocab_size"],
        n_layers=donor_cfg["n_layers"],
        max_seq_len=min(4096, donor_cfg["max_seq_len"]),
    )
    install_rank16_lora(donor_body)
    model = Sham2Unified(cfg, donor_body)
    payload = load_sham2_heads(
        model,
        args.heads,
        file_sha256(donor_path),
        file_sha256(tokenizer_path),
    )
    if payload.get("format") != "sham2-unified-heads-v2":
        raise ValueError("partial gate accepts only the new sham2-unified-heads-v2 artifact")
    if payload.get("training_scope") != "partial, not full":
        raise ValueError("candidate head is not explicitly labelled partial, not full")
    if payload.get("trained_stages") != ["identity", "terminal"]:
        raise ValueError("candidate head must contain exactly identity and terminal stages")
    if payload.get("missing_full_stages") != ["tools", "arabic"]:
        raise ValueError("candidate head must preserve tools/arabic as missing")

    model.to(torch.device("cpu"))
    model.eval()
    torch.manual_seed(args.seed)

    training_prompts = {
        item["prompt"].strip()
        for item in (
            json.loads(line)
            for line in (data_dir / "train.jsonl").read_text(encoding="utf-8").splitlines()
            if line.strip()
        )
    }
    leaked = [row["prompt"] for row in rows if row["prompt"].strip() in training_prompts]
    if leaked:
        raise ValueError(f"held-out leakage detected: {len(leaked)} prompts also occur in training")

    exact_matches = 0
    same_effect_matches = 0
    losses: list[float] = []
    details: list[dict] = []
    with torch.inference_mode():
        for index, row in enumerate(rows, 1):
            input_ids = tokenizer.encode(row["prompt"]).ids
            if not input_ids:
                raise ValueError(f"held-out row {index} tokenized to an empty input")
            if len(input_ids) > cfg.max_seq_len:
                raise ValueError(f"held-out row {index} exceeds the donor context limit")
            target_values, valid_values = encode_target_bytes(
                row["target"], cfg.block, f"held-out row {index}"
            )
            input_tensor = torch.tensor([input_ids], dtype=torch.long)
            target_tensor = torch.tensor([target_values], dtype=torch.long)
            valid_mask = torch.tensor([valid_values], dtype=torch.bool)
            latents = model(input_tensor)
            masked_logits = model.writer.logits(target_tensor, valid_mask, latents)
            selected_logits = masked_logits[0][valid_mask[0]].float()
            selected_targets = target_tensor[0][valid_mask[0]]
            loss = float(F.cross_entropy(selected_logits, selected_targets).cpu())
            if not math.isfinite(loss):
                raise RuntimeError(f"non-finite gate loss at held-out row {index}")
            losses.append(loss)
            predicted_ids = model.writer.generate(
                latents, steps=cfg.diffusion_steps, temperature=0.0
            )[0].tolist()
            predicted = decode_target_bytes(predicted_ids)
            exact = predicted == row["target"].strip()
            same_effect = terminal_source.same_effect(row["target"], predicted)
            exact_matches += int(exact)
            same_effect_matches += int(same_effect)
            details.append({
                "source_set": row["source_set"],
                "prompt": row["prompt"],
                "expected_command": row["target"],
                "predicted_command": predicted,
                "exact_match": exact,
                "same_effect": bool(same_effect),
                "cross_entropy": loss,
            })
            print(
                f"[partial-gate] {index}/{len(rows)} source={row['source_set']} "
                f"exact={int(exact)} same_effect={int(same_effect)} loss={loss:.5f}",
                flush=True,
            )

    total = len(rows)
    exact_rate = exact_matches / total
    effect_rate = same_effect_matches / total
    passed = total == 26 and effect_rate >= args.minimum_same_effect
    report = {
        "format": "sham2-partial-terminal-gate-v1",
        "target_encoding": "UTF-8 bytes with EOS and explicit padding loss mask",
        "writer_vocab_size": BYTE_VOCAB,
        "candidate_artifact_format": payload["format"],
        "candidate_training_scope": payload["training_scope"],
        "trained_stages": payload["trained_stages"],
        "missing_stages": payload["missing_full_stages"],
        "gate_scope": [
            {"source_set": "terminal_tasks.HELDOUT", "examples": len(terminal_rows)},
            {"source_set": "rewordings.HELDOUT2", "examples": len(reworded_rows)},
        ],
        "examples": total,
        "exact_matches": exact_matches,
        "exact_match_rate": exact_rate,
        "same_effect_matches": same_effect_matches,
        "same_effect_rate": effect_rate,
        "minimum_same_effect_rate": args.minimum_same_effect,
        "mean_cross_entropy": sum(losses) / len(losses),
        "donor_sha256": file_sha256(donor_path),
        "tokenizer_sha256": file_sha256(tokenizer_path),
        "head_sha256": file_sha256(args.heads),
        "head_path": str(Path(args.heads).resolve()),
        "previous_writer_donor_gate_used": False,
        "tools_evaluated": False,
        "arabic_evaluated": False,
        "gate": "passed" if passed else "failed",
        "failure_reasons": [] if passed else [
            f"same-effect accuracy {effect_rate:.3f} is below the required {args.minimum_same_effect:.3f}"
        ],
        "cases": details,
    }
    report_path = Path(args.report).expanduser().resolve()
    report_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = report_path.with_suffix(report_path.suffix + ".tmp")
    tmp.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(report_path)
    print(json.dumps({
        "gate": report["gate"],
        "examples": total,
        "exact_matches": exact_matches,
        "exact_match_rate": exact_rate,
        "same_effect_matches": same_effect_matches,
        "same_effect_rate": effect_rate,
        "minimum_same_effect_rate": args.minimum_same_effect,
        "mean_cross_entropy": report["mean_cross_entropy"],
        "report": str(report_path),
    }, ensure_ascii=False, indent=2), flush=True)
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
