# For the Sham engineer: separate Arabic SFT notebook (review)

Added 2026-10-15 with the owner's approval. Additive only. Nothing of yours was changed.

## What it is
- New private Kaggle kernel `jonsnowjonsnow/sham-arabic-sft`. Source: `ai-system/colab/sham_small/kaggle_notebooks/arabic_sft/`. Push workflow: `.github/workflows/sham-arabic-sft-push.yml`.
- Starts from a **copy** of `sham-chat-checkpoint/final_chat.pt` (read-only). Every later run resumes from its own output.
- Publishes to a **new** private dataset `sham-chat-arabic-sft-checkpoint`: `final_chat.pt`, the tokenizers, `sft_progress.json` and `sft_eval_history.json`.
- It mirrors your chat-stage notebook:
  - V3/V4 cells (taken verbatim from `kaggle_auto_resume.py`).
  - Clone cell.
  - `load_checkpoint`, `ShamTextTokenizer`, `build_chat_example` / `build_multiturn_example`, `batch_examples`.
  - `train(TrainConfig)` with the same lr 5e-5, wd 0.1, grad_accum 2 and session hours.
  - `sham_eval.evaluate`, `save_checkpoint`, `publish_dataset`.
- Model config and hyperparameters are untouched.
- Before training it checks that the keys, shapes and config are identical to the source checkpoint. On a mismatch it stops and reports instead of forcing anything.

## Data (streamed from Hugging Face, a share per source per session, progress saved)
| Source | License | Kind |
|---|---|---|
| arbml/CIDAR | apache-2.0 | native |
| CohereLabs/aya_dataset (Arabic) | apache-2.0 | human-written |
| FreedomIntelligence/alpaca-gpt4-arabic | apache-2.0 | GPT-4 / translated |
| FreedomIntelligence/evol-instruct-arabic | none stated | translated |
| 2A2I/Arabic-OpenHermes-2.5 | apache-2.0 | translated |
| HeshamHaroon/saudi-dialect-conversations | apache-2.0 | GPT-4o Najdi, multi-turn |
| MBZUAI/Bactrian-X (ar) | **CC-BY-NC-4.0** | MT + GPT answers |
| CohereLabs/aya_collection_language_split (standard_arabic) | apache-2.0 | templated / translated |
| hammh0a/Hala-4.6M-SFT | **CC-BY-NC-4.0** | MT, 4.06M rows |

Limit the sources with `SHAM_SFT_SOURCES=key1,key2`.

## Understanding vs memorization
- 2% of questions, chosen by a stable sha1 bucket, are never trained on.
- 64 of them are frozen in `sft_progress.json` as a fixed yardstick.
- Every save logs the held-out loss and sample generations, plus your `sham_eval` before/after, into `sft_eval_history.json`.

## Studio
- `sham-modelscope.yml` gained one step, gated by the repo variable `SHAM_STUDIO_ARABIC_SFT == '1'` (unset = OFF).
- When ON, it places this dataset's `final_chat.pt` instead of the chat-stage one before the sync.
- Note: `app.py` prefers `final_chat_self.pt` if present.

## Not done (proposal)
- Not added to `sham-restarter`.
- Proposal: track `sham-arabic-sft` as a 4th kernel with the same breaker and daily cap, after your approval.
- Phase 2, not trained: a small code mix (5–10%) from Magicoder-OSS-Instruct-75K (MIT), CodeFeedback-Filtered-Instruction (apache-2.0), nvidia/OpenCodeInstruct (CC-BY-4.0), and evol-instruct-arabic's code questions.

## Merge proposal (toward ONE final checkpoint)
- `ai-system/colab/sham_small/sham_sft_merge.py` is standalone. No workflow runs it.
- What it does:
  - Refuses to merge unless the config, keys and shapes match.
  - Averages the chat and SFT `state_dict`s at each ratio in `--ratios`.
  - Scores every ratio on `sham_eval`'s fixed pairs plus the SFT frozen held-out questions.
  - Saves the best ratio only if `--out` is given, and never publishes.
- The SFT notebook keeps the same config, keys, shapes and tokenizer as `final_chat.pt`, which it checks before training, so averaging stays possible.
