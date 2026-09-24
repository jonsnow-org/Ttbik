# Sham — pending items to handle when we resume Sham work

## 2026-09-24 — Kaggle notebook failures reported by the owner (check first when resuming Sham)
- Email 1 (≈03:11): **"Your notebook failed" — `notebook24ffaf0b22`** → open it on Kaggle, read the log, find the cause, fix.
- Email 2 (same time): **"Scheduled notebook ran" — `notebookf4a8feee6`** → ran OK; still check whether it produced its expected output (checkpoint/dataset/Telegram report).
- Map both auto-generated notebook ids to our notebooks (Track A/B, video/audio/image tokenizers, orchestrator) before fixing.
- Use the correct "sham" naming in any new/renamed files (task #51).

## 🧭 HOW TO RESUME SHAM (Claude: do this first, automatically)
1. `git fetch origin sham-status && git show origin/sham-status:sham-registry.json` (and `sham-report.txt`)
   — the PUBLIC, privacy-safe registry written by the owner's **sham_control_center.ipynb**.
   It uses generic aliases only ("مسار ترميز الصورة 1"): status, role (primary/duplicate), progress,
   error summary, and `pipeline.next_step`. **Owner directive 2026-09-24: Claude must NOT see or ask
   for notebook names, links, titles or contents** — refer to notebooks by alias only; the owner
   maps aliases to real notebooks from her full Telegram report.
2. Tell the owner the current step from `pipeline.next_step`, then fix any `status: error`
   primary kernels (the failure text is in the registry).
3. If the branch is missing: ask the owner to run `sham_control_center.ipynb` once
   (Accelerator None, Internet On, same 5 secrets) — nothing else needed.
- Stage 2 now auto-uses pretrained `image_tokenizer.pt` / `audio_tokenizer.pt` found anywhere
  under /kaggle/input (attach the tokenizer datasets as inputs), instead of training tiny new ones.
- The resume orchestrator auto-discovers its CPU targets from the registry when `TARGET_KERNELS = []`.

## Owner directives (2026-09-24, permanent)
- **Engineer's notebooks are his domain.** Any Sham-related Kaggle notebook that isn't one of
  Claude's known tracks (TRACKS in sham_registry.py) is the engineer's: reported to the owner only,
  excluded from Claude's public registry, never treated as Claude's work to fix.
- **Claude never sees notebook names/links/contents** — aliases + status/progress/error only.
- Stage 2 accepts BOTH tokenizer sources automatically (dedicated CPU tracks or any other attached
  dataset carrying `*_tokenizer.pt`): `tokenizer_select.py` picks the most-trained compatible one,
  else trains fresh — no conflict.
- Known live-edit bug reported by the owner's run: [المرحلة الأولى 2] fails with
  `NameError: realistic_steps` — the repo version defines `realistic_steps_for_session`; the Kaggle
  copy's cell 9 uses the short name. Fix = rename in that cell.

## 2026-09-24 — إصلاح جمع البيانات (بلا تكرار) وقبول أدوات الترميز غير المتوافقة
- `sham_data_sources.py`: مصادر موثّقة متعددة (صوت: CV17-ar mirror، FLEURS-ar، ClArTTS، ArVoice بشري؛ صورة: Flickr30k، COCO، CC3M؛ فيديو: Kinetics بترخيص CC فقط)، سجل `{kind}_ledger.json` = موضع استئناف خام لكل مصدر + بصمات (sha1 + dHash للتقارب) مدموجة من كل المدخلات.
- السبب: Common Voice الأصلي فارغ على HF، و ucf101-subset = فيديوهان فقط، و skip كان يعدّ المحفوظ لا المقروء، والمرحلة 2 تأخذ نفس أول 3000 صورة كل مرة.
- `tokenizer_select.py`: يصلح غير المتوافق ويقبله (توسيع/ضغط القاموس، إعدادات إصدار أقدم) بدل تجاهله.
- المرحلة الأولى على Kaggle: الخلية 9 ما زالت تستخدم `realistic_steps` القديم — الصحيح `realistic_steps_for_session` (نسخة المستودع سليمة).
