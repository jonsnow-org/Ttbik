# Sham — pending items to handle when we resume Sham work

## 2026-09-24 — Kaggle notebook failures reported by the owner (check first when resuming Sham)
- Email 1 (≈03:11): **"Your notebook failed" — `notebook24ffaf0b22`** → open it on Kaggle, read the log, find the cause, fix.
- Email 2 (same time): **"Scheduled notebook ran" — `notebookf4a8feee6`** → ran OK; still check whether it produced its expected output (checkpoint/dataset/Telegram report).
- Map both auto-generated notebook ids to our notebooks (Track A/B, video/audio/image tokenizers, orchestrator) before fixing.
- Use the correct "sham" naming in any new/renamed files (task #51).

## 🧭 HOW TO RESUME SHAM (Claude: do this first, automatically)
1. `git fetch origin sham-status && git show origin/sham-status:sham-registry.json` (and `sham-report.txt`)
   — written by the owner's **sham_control_center.ipynb** run on Kaggle. It lists every Kaggle
   kernel (auto-identified by content, not by name), its last status + failure reason, which one
   is the primary per track vs duplicates, every dataset + progress metrics, and
   `pipeline.next_step` (the current step, in Arabic).
2. Tell the owner the current step from `pipeline.next_step`, then fix any `status: error`
   primary kernels (the failure text is in the registry).
3. If the branch is missing: ask the owner to run `sham_control_center.ipynb` once
   (Accelerator None, Internet On, same 5 secrets) — nothing else needed.
- Stage 2 now auto-uses pretrained `image_tokenizer.pt` / `audio_tokenizer.pt` found anywhere
  under /kaggle/input (attach the tokenizer datasets as inputs), instead of training tiny new ones.
- The resume orchestrator auto-discovers its CPU targets from the registry when `TARGET_KERNELS = []`.
