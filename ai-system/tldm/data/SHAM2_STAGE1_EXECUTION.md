# Sham 2 Stage 1 execution contract

This commit launches the gated Stage 1 job via the branch-specific workflow.

## Immutable inputs
- ModelScope donor: `novaai2026/sham-v2/final_merged.pt` (read-only).
- Tokenizer: `novaai2026/sham-v2/sham_small_tokenizer.json`.
- JSONL training: 46 real fixed records (16 identity + 30 terminal).
- JSONL evaluation: 26 records (12 terminal_tasks.HELDOUT + 14 rewordings.HELDOUT2).
- Identity-only held-out prompts: 8, prompts-only with no invented targets.
- Missing stages remain `tools: missing` and `arabic: missing`; status remains `partial, not full`.

## Required sequence
1. Validate the existing ModelScope CN bearer credential through `/openapi/v1/users/me` without printing its value.
2. Run `--check-donor` with the existing repository `MODELSCOPE_TOKEN` secret explicitly passed to ModelScope snapshot download at `https://www.modelscope.cn`.
3. Continue only if the donor result is `compatible` with no missing/unexpected keys and no shape/dtype mismatches against the canonical ShamSmall loader.
4. Train only `--stage available` (identity + terminal). Frozen donor body; rank-16 new LoRA and T-LDM head; no donor weights in output.
5. Write a new `sham2-unified-heads-v3` artifact with donor, tokenizer and dataset SHA-256 provenance. The writer must be the canonical masked discrete byte-diffusion implementation: UTF-8 bytes + EOS, vocabulary 257, position embeddings and cross-attention to the full latent sequence. Never reuse a v2 continuous-vocabulary artifact or overwrite the legacy head.
6. Evaluate only terminal_heldout + heldout2 with the new head. Do not use the 2026-11-18 writer_donor gate.
7. Upload the donor report, training report, gate report and new head as a GitHub Actions artifact for owner review.

## Hard stop
No PR merge occurs in this workflow. The first completed training run (60 identity + 600 terminal steps) saved a `v2` head but its fresh gate scored 0/26 exact and 0/26 same-effect; the candidate is rejected. Inspection found the v2 writer had discarded latent sequence order and omitted output positions. The v3 byte-diffusion path is now under offline CI validation. It must pass its writer self-test and fixed-data byte-length check before a new CN donor preflight and a clean run ID are allowed. No PR merge occurs on a failed or unverified gate.
