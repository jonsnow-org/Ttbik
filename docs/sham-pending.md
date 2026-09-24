# Sham — pending items to handle when we resume Sham work

## 2026-09-24 — Kaggle notebook failures reported by the owner (check first when resuming Sham)
- Email 1 (≈03:11): **"Your notebook failed" — `notebook24ffaf0b22`** → open it on Kaggle, read the log, find the cause, fix.
- Email 2 (same time): **"Scheduled notebook ran" — `notebookf4a8feee6`** → ran OK; still check whether it produced its expected output (checkpoint/dataset/Telegram report).
- Map both auto-generated notebook ids to our notebooks (Track A/B, video/audio/image tokenizers, orchestrator) before fixing.
- Use the correct "sham" naming in any new/renamed files (task #51).
