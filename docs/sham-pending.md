# Sham — pending items to handle when we resume Sham work

## 2026-09-24 — Kaggle notebook failures reported by the owner (check first when resuming Sham)
- Email 1 (≈03:11): **"Your notebook failed" — `notebook24ffaf0b22`** → open it on Kaggle, read the log, find the cause, fix.
- Email 2 (same time): **"Scheduled notebook ran" — `notebookf4a8feee6`** → ran OK; still check whether it produced its expected output (checkpoint/dataset/Telegram report).
- Map both auto-generated notebook ids to our notebooks (Track A/B, video/audio/image tokenizers, orchestrator) before fixing.
- Use the correct "sham" naming in any new/renamed files (task #51).

## 2026-09-24 — إصلاح المسارات (الاستئناف تلقائي بلا «Add Input»)
- جديد: `sham_inputs.py` — كل دفتر يجلب آخر نسخة من مجموعة بياناته عبر Kaggle API إن لم تكن مرفقة (إلى /tmp/sham_inputs)، و`resume_text_lineage` يختار أعلى خطوة في مجموعة المسار نفسه مع أداة تقسيم النص المحفوظة معها (وإلا تفرّع لمرة واحدة). `tokenizer_select` و`Ledger.load` و`text_stream_position` صارت تبحث في المكانين.
- المرحلة الأولى والمسار A: ويكيبيديا تكمل من الموضع المحفوظ (text_stream_progress_*.json، يبدأ من 20,000 عند غيابه) بدل نفس أول المقالات.
- المسار A: لا يمكن بعد الآن أن يستأنف من المجموعة القديمة بلا -v2.
- المسار B: يرفض سلالة أداة التقسيم الصغيرة (4000) ويتفرّع مرة من أعلى نقطة نصية (A أو المرحلة الأولى)؛ الخطوة تراكمية في final.pt؛ الموضوع يتغيّر كل دورة؛ مدوّنة الزحف تُنشر مع النقطة وكل دورة تتدرّب على الجديد فقط (`train_on_new_only`).
- الصوت/الصورة/الفيديو: يجلب كل منها مجموعته تلقائياً (الفيديو يجلب أداة ترميز الصورة أيضاً).
- المرحلة الثانية: تجلب كل مدخلاتها، تكمل من ناتجها السابق إن وُجد، وتنشر إلى `sham-multimodal-checkpoint`.
- دفتر جديد `sham_bot_test.ipynb` يحل محل خلية تجربة البوت القديمة (نوفا) — مسار «bot_test» في sham_registry.
- المنسّق في المستودع أصلاً TARGET_KERNELS = [] ويشمل مسار الصوت؛ نسخة Kaggle القديمة كانت قائمة يدوية.
- **قرار المالكة (المعالج):** كل دفتر يعمل على CPU أو GPU، والمالكة تختار لكل دفتر. المنسّق يراقب كل المسارات (بما فيها المرحلتان 1 و2) عبر `resume_kernel(auto_accelerator=True)`: دفتر CPU لا يُنقل إلى GPU أبداً؛ دفتر GPU ينتقل إلى CPU عند نفاد الرصيد (رفض الدفع أو فشل برسالة حصة GPU) ويُجرَّب GPU مجدداً كل 24 ساعة. الذاكرة في مجموعة خاصة `sham-orchestrator-state`.
- على المالكة: استيراد الدفاتر من GitHub، إضافة الأسرار، ضبط GPU للمرحلتين، وإيقاف/حذف النسخ القديمة كي لا تُعدّ «أساسية».

## 2026-09-24 — إصلاح: فقدان محتمل لنقطة حفظ منشورة تحت الاسم القديم nova-small-checkpoint
- المالكة أبلغت أن دفترها الحالي وصل 36 ألف خطوة، ولا تعرف بالتأكيد هل نُشرت تحت الاسم الجديد
  sham-checkpoint أم القديم nova-small-checkpoint (قد يوجد الاثنان).
- الإصلاح السابق (resume_text_lineage) كان يبحث فقط عن sham-checkpoint — لو كانت الخطوات الـ36 ألف
  تحت الاسم القديم فقط، كان سيبدأ من الصفر بصمت. أُصلح: كل مكان يستأنف نص شام
  (sham_small_training، stage2، Track A، Track B، sham_bot_test) يضيف الآن
  forks=[..., "nova-small-checkpoint"] فيبحث في الاسمين ويختار الأعلى خطوة.
- لم تُؤكَّد بعد الخطوة الفعلية المحفوظة على Kaggle نفسه — عند أول تشغيل للدفتر الجديد راقبي سطر
  "resumed from ..." في الخرج للتأكد أنه فعلاً التقط الـ36 ألف خطوة قبل الوثوق بالنتيجة.

## 2026-09-24 — تصحيح: الاستئناف من أي Input مُرفق يدوياً، بغض النظر عن اسمه
- المالكة صححت: الدفاتر القديمة كانت أصلاً تبحث عن آخر نقطة حفظ بشكل عام
  (Path("/kaggle/input").rglob("step_*.pt")) — أي مجموعة تُرفق يدوياً كـ Input كانت تُستأنف بغض
  النظر عن اسمها. إصلاحي السابق (البحث بالاسم sham-checkpoint / nova-small-checkpoint) كان أضيق
  من ذلك: لو أُرفقت المجموعة يدوياً تحت اسم آخر (مثلاً nova-small-checkpoint أو أي عنوان قديم)،
  لم يكن `resume_text_lineage` يجدها لأنه يبحث بالاسم فقط.
- الإصلاح: `resume_text_lineage` في sham_inputs.py يفحص الآن أولاً *كل* مجلد مُرفق أو مُنزَّل تحت
  /kaggle/input أو /tmp/sham_inputs (بغض النظر عن اسمه)، ويختار الأعلى خطوة من بينها — تماماً كما
  كانت الدفاتر تفعل قبل أي تعديل. البحث بالاسم (own ثم forks عبر Kaggle API) يبقى فقط احتياطاً
  عندما لا يوجد أي شيء مُرفق إطلاقاً (لا يوجد Input ولا تنزيل سابق).
- اختُبر: مجموعة مُرفقة باسم عشوائي غير مذكور في الكود تُكتشف وتُستخدم؛ الأعلى خطوة بين عدة مُرفقات
  يفوز؛ أداة تقسيم نص صغيرة جداً تُرفض حتى لو كانت الأعلى خطوة، وتُختار غيرها المؤهلة.

## 2026-09-27 — الفيديو بصوته (طلب المالكة: شام مدمج، لا فيديو صامت)
- `sham_data_sources.collect("video")` يستخرج مع الإطارات الثمانية صوت نفس الثواني الأربع (16 kHz أحادي)،
  `"audio": null` للمقطع الصامت. `video_tokenizer.encode_video_with_audio()` يضع الصوت داخل نفس
  تسلسل الفيديو بعد الإطارات: `<AUDIO_START>[80 رمز]<AUDIO_END>` لكل 2.56 ثانية (مقطعان لكل فيديو)،
  و`decode_video_with_audio()` عكسه. المقطع الصامت = `encode_video()` حرفياً.
- دفتر الفيديو يجلب أداة ترميز الصوت أيضاً ويحفظ `num_audio_segments` مع كل تسلسل. بلا أداة صوت يعمل صامتاً مع تحذير.
- اختُبر بمقاطع MP4 حقيقية (بصوت وبلا صوت) مولّدة بـ ffmpeg، من الجمع حتى الترميز وفك الترميز.
- متابعة لاحقة: generate.generate_video وserve.py /generate/video يولّدان الإطارات فقط؛ عند بناء مرحلة تدريب
  الفيديو يجب أن يولّدا الصوت أيضاً (decode_video_with_audio جاهز).

## 2026-09-27 — مصدر الفيديو: أرشيفات Kinetics الأصلية بدل نسخة HF الصغيرة
- تصحيح: قلتُ سابقاً إن دفتر الفيديو القديم جمع 0 وإن نسخة HF بلا is_cc — خطأ (قرأتُ قائمة أعمدة مقطوعة).
  المالكة أكدت أنه جمع 50 مقطعاً، ونسخة HF فيها is_cc فعلاً. لكنها 4,000 مقطع فقط (~3% مرخّص) ووصفها رقم
  فئة لا كلمات. الـ50 مقطعاً القديمة صامتة وبلا وصف (خلية الترميز القديمة) وتبقى في المجموعة كبيانات صورة صالحة.
- الآن: `kinetics_tar` في sham_data_sources يبث الأرشيفات الأصلية من
  s3.amazonaws.com/kinetics/400 (242 جزء تدريب + 20 تحقق، 1.6 GB للجزء) مع annotations/{train,val}.csv
  الرسمي (is_cc). ~3% مرخّص (7,595 مقطعاً)، كل مقطع 10 ثوانٍ بصوت AAC. موضع استئناف لكل جزء.
- اختُبر حياً من بيئة التطوير: 5 مقاطع مرخّصة (celebrating, snowboarding, playing guitar, digging,
  busking) بـ 8 إطارات و4 ثوانٍ صوت ووصف، واستئناف بلا تكرار، ثم خلية الترميز في الدفتر (مقطعا صوت لكل فيديو).
- بديل أغنى لاحقاً: HuggingFaceFV/finevideo (43k فيديو CC-BY بصوت وأوصاف ونصوص كلام) — مقفل (gated)
  ويحتاج HF_TOKEN وقبول الشروط مرة؛ لم يُتحقق من أعمدته.

## 2026-09-27 — تحديث القرار: دفتر الفيديو الجديد وحده (القديم بخلايا قديمة، لا يُعاد استيراده ولا يُشغَّل)
- `MULTI_WRITER_TRACKS` صار فارغاً: المنسّق يستأنف دفتر فيديو واحداً (الأحدث). الدمج قبل النشر باقٍ كحماية.

## (سابق) 2026-09-27 — دفترا الفيديو معاً
- كلاهما ينشر إلى sham-video-corpus. لمنع المحو المتبادل: قبل النشر يجلب الدفتر آخر نسخة منشورة الآن
  (`fetch_dataset(..., fresh=True)`) ويدمج (`merge_corpus_lines`: نفس المقطع = نفس hash، بلا تكرار)،
  ويدمج سجل البصمات أيضاً. كل تشغيل يبدأ من جزء أرشيف عشوائي (`shuffle_splits`) فلا يتسابقان على نفس المقاطع.
- sham_registry: `MULTI_WRITER_TRACKS = {"video_corpus"}` — كل دفاتر الفيديو "primary" ويستأنفها المنسّق كلها.
- شرط: الدفتر القديم يجب أن يحمل الخلايا الجديدة (إعادة استيراد داخله)، وإلا يكتب فوق المجموعة بلا دمج وبفيديو صامت.
- بقي نافذة سباق لثوانٍ عند النشر المتزامن تماماً؛ نادرة، والخسارة إن حدثت دفعة واحدة تُجمع في التشغيل التالي.

## ⛔ قاعدة المالكة (2026-09-27، دائمة): لا تحديثات تلقائية لكود شام
- الدفاتر تسحب فرع `claude/free-services-marketplace-h6rwk2` في كل تشغيل، فأي دفع إليه يغيّر الدفاتر تلقائياً.
- لذلك: Claude لا يدفع أي تعديل على كود شام إلى ذلك الفرع. كل العمل الجديد على فرع `claude/sham-next`،
  ويُدمج في فرع الدفاتر فقط بعد أن تُبلَّغ المالكة بما يتغيّر وأي دفتر يتأثر، وتوافق.
- النسخة المستخدمة الآن محفوظة كفرع `claude/sham-pinned-2026-09-27` (دفع الوسوم مرفوض من بيئة التطوير) (للرجوع إليها إن غيّر أحد آخر الكود).
- تنبيه: مساهمون آخرون (المهندس وغيره) يدفعون أيضاً إلى فرع الدفاتر؛ تثبيت مستقل عن الجميع يتطلب تغيير
  BRANCH في أول خلية من كل دفتر إلى ذلك الفرع — لم يُنفَّذ، بانتظار قرار المالكة.

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
