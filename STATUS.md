# حالة مشروع شام — 2026-10-21 17:17 UTC

> تُحدَّث تلقائياً كل 3 ساعات من GitHub Actions. الدفاتر بأسماء مستعارة عمداً (قرار المالكة)؛ الأسماء الحقيقية في تيليجرام المالكة فقط.

## التنبيهات (ابدأ منها)
- ❌ دفتر أساسي فشل: مسار ترميز الصوت 3 (audio_tokenizer) — (بلا رسالة فشل من Kaggle) الحالة الخام: <notebook> has status "KernelWorkerStatus.ERROR"
- ⚠ مجموعة الخط الرئيسي sham-checkpoint غير موجودة في الحساب
- ⚠ مجموعة الخط الرئيسي sham-multimodal-checkpoint غير موجودة في الحساب
- ⚠ مجموعة الخط الرئيسي sham-chat-checkpoint غير موجودة في الحساب

## المراحل
- ✅ المرحلة الأولى — تدريب النص الأساسي (GPU) — دفتر: complete
- ✅ مسار ترميز الصورة (VQ-VAE) — دفتر: complete
- ✅ مسار ترميز الصوت (VQ-VAE) — دفتر: error — تقدم: {'samples_consumed': 40208, 'step': 22984, 'last_run_sources': {'cv17-ar': 1000}, 'codebook_usage': 1996, 'recon': 0.013131437182892114}
- ✅ مسار جمع وترميز الفيديو — دفتر: complete — تقدم: {'videos_consumed': 2267}
- ✅ المرحلة الثانية — دمج الصورة والصوت مع النص (GPU) — دفتر: complete
- ✅ المسار A — التدريب النصي المستمر (CPU) — دفتر: complete
- ✅ المسار B — البحث الذاتي من الإنترنت (CPU) — دفتر: missing
- ✅ المرحلة الثالثة — التجميع والمحادثة (كل الوسائط + البحث + الدمج) — دفتر: running

**الخطوة التالية المقترحة:** شام متعدد الوسائط جاهز (نص + صورة + صوت). — الخطوة التالية: تشغيل خادم شام (serve.py) على النقطة final_multimodal.pt وربطه بالموقع/البوت. أخبري Claude: «لنكمل شام».

## الدفاتر على Kaggle (بأسماء مستعارة)
- complete | المدرّب الحي 1 | الدور: primary | آخر تشغيل 2026-10-10 | GPU
- complete | المرحلة الثالثة 4 | الدور: duplicate | آخر تشغيل 2026-10-02
- complete | المرحلة الثالثة 3 | الدور: duplicate | آخر تشغيل 2026-10-01
- complete | المرحلة الثالثة 2 | الدور: duplicate | آخر تشغيل 2026-09-30 | GPU
- complete | مركز تحكم شام 1 | الدور: tool | آخر تشغيل 2026-09-24
- cancelAcknowledged | مسار ترميز الصورة 2 | الدور: duplicate | آخر تشغيل 2026-09-28
- error | مسار ترميز الصوت 2 | الدور: duplicate | آخر تشغيل 2026-09-23 | الخطأ: ---> 58             raise ConnectionError(      60         except HTTPError as e: ConnectionError: Connection error trying to communicate with service. قبل الفشل: 0.00s - to python to disable frozen m
- running | المرحلة الثالثة 5 | الدور: primary | آخر تشغيل 2026-10-21
- running | الدفتر الشامل 1 | الدور: primary | آخر تشغيل 2026-10-21
- complete | المرحلة الثالثة 1 | الدور: duplicate | آخر تشغيل 2026-09-28
- running | دفتر المحادثة والمرمزات 1 | الدور: primary | آخر تشغيل 2026-10-21
- cancelAcknowledged | تجربة بوت شام 1 | الدور: tool | آخر تشغيل 2026-10-09
- cancelAcknowledged | المرحلة الثانية 2 | الدور: duplicate | آخر تشغيل 2026-10-10 | GPU
- complete | مسار جمع وترميز الفيديو 1 | الدور: primary | آخر تشغيل 2026-10-01
- error | مسار ترميز الصوت 3 | الدور: primary | آخر تشغيل 2026-10-11 | الخطأ: (بلا رسالة فشل من Kaggle) الحالة الخام: <notebook> has status "KernelWorkerStatus.ERROR"
- complete | مسار ترميز الصورة 3 | الدور: primary | آخر تشغيل 2026-10-12
- running | دفتر المسارين A وB 1 | الدور: primary | آخر تشغيل 2026-10-21
- complete | المسار A 1 | الدور: primary | آخر تشغيل 2026-10-12
- complete | المرحلة الأولى 2 | الدور: primary | آخر تشغيل 2026-10-10
- complete | المرحلة الثانية 1 | الدور: primary | آخر تشغيل 2026-09-23
- complete | مسار ترميز الصورة 1 | الدور: duplicate | آخر تشغيل 2026-09-23
- error | مسار ترميز الصوت 1 | الدور: duplicate | آخر تشغيل 2026-09-23
- error | المرحلة الأولى 1 | الدور: duplicate | آخر تشغيل 2026-09-22
- (+5 دفتراً غير تابع لشام، +3 من دفاتر المهندس — مخفية)

## مصنع GitHub المجاني (آخر التشغيلات)
- Sham Status (supervision snapshot): 2026-10-21T17:17 in_progress
- Sham CI (contract + self-tests, read-only): 2026-10-21T17:16 success ، 2026-10-21T17:12 success ، 2026-10-21T17:05 success ، 2026-10-21T16:29 success
- Sham Collector (free CPU runner): 2026-10-21T17:08 in_progress
- Sham CPU Trainer (free CPU runner, slow and continuous): 2026-10-21T17:04 in_progress
- Sham Merge + Repair + Eval (free CPU runner): 2026-10-21T16:08 in_progress
- Sham Restarter (keeps the Kaggle notebooks in a continuous cycle): 2026-10-21T15:00 success

## آخر أخطاء مصنع GitHub (أين فشل بالضبط)
- لا أخطاء حديثة ✅

## المجموعات (ما كُتب أم لا، ومن يكتبها)
| المجموعة | الحجم | آخر تحديث | الكاتب المعلن | الدور |
|---|---|---|---|---|
| sham-checkpoint | — | غير موجودة | stage1_text | نقطة حفظ النص الأساسي (المرحلة الأولى) + مُرمِّز النص العام |
| nova-small-checkpoint | — | غير موجودة | — | الاسم القديم لـ sham-checkpoint — يُقرأ احتياطاً فقط |
| sham-image-tokenizer-checkpoint | — | غير موجودة | image_tokenizer | مُرمِّز الصورة VQ-VAE |
| sham-audio-tokenizer-checkpoint | — | غير موجودة | audio_tokenizer | مُرمِّز الصوت VQ-VAE |
| sham-video-corpus | — | غير موجودة | video_tokenizer | فيديو مُجمَّع ومُرمَّز |
| sham-multimodal-checkpoint | — | غير موجودة | stage2_multimodal | نقطة حفظ المرحلة الثانية (نص + صورة + صوت) |
| sham-chat-checkpoint | — | غير موجودة | chat_stage | نقطة حفظ مرحلة المحادثة والدمج (الخط الرئيسي للنموذج) |
| sham-cpu-track-checkpoint | — | غير موجودة | — | قديم (v1) — لا يُكتب |
| sham-cpu-track-checkpoint-v2 | — | غير موجودة | track_a | المسار A: تدريب نصي مستمر على CPU |
| sham-research-track-checkpoint-v2 | — | غير موجودة | track_b | المسار B: بحث ذاتي من الإنترنت + تدريب CPU |
| sham-crawl-checkpoint | — | غير موجودة | live_trainer | المدرّب الحي على Kaggle (نموذج) |
| sham-crawl-corpus | — | غير موجودة | live_trainer | نصوص المدرّب الحي على Kaggle |
| sham-crawl-legacy | — | غير موجودة | repair | ما نشره زاحف المهندس الأول داخل مجموعة المرحلة الثانية (يُنقل بالإصلاح) |
| sham-chat-checkpoint-incoming | — | غير موجودة | repair | ما نُشر فوق مجموعة المحادثة من دفتر آخر (يُنقل بالإصلاح) |
| sham-crawl-gh | — | غير موجودة | gh_cpu_trainer | مدرّب CPU على GitHub (نموذج) |
| sham-crawl-gh-corpus | — | غير موجودة | gh_cpu_trainer | نصوص مدرّب CPU على GitHub |
| sham-crawl-gh-collect-corpus | — | غير موجودة | gh_collector | الزاحف العام على GitHub (نصوص فقط) |
| sham-merged-checkpoint | — | غير موجودة | gh_merge_eval | ناتج الدمج والإصلاح على CPU (يُدمج في مرحلة المحادثة كمصدر) |
| sham-reports | — | غير موجودة | any (عبر sham_reports.py من كل دفتر) | نسخة من تقارير الجلسات (للإشراف) |
| sham-research-track-checkpoint | — | غير موجودة | — | الاسم القديم (v1) للمسار B — يُقرأ احتياطاً فقط |
| sham-checkpoint-v2 | — | غير موجودة | — | اسم بديل يقترحه الدفتر الأول عند تعارض اسم المجموعة — ليس مجموعة قائمة |
| sham-audio-tokenizer-adult-synth | — | غير موجودة | — | مُرمِّز صوت (VQ) تجربة قديمة — مرشّح صوتي، تُدمج أوزانه بحسب نوعها (صوت) حين تتوافق البنية، وإلا يبقى مرشّحاً |
| sham-audio-tokenizer-adult-synth-v2 | — | غير موجودة | — | مُرمِّز صوت (VQ) النسخة الثانية للتجربة — مرشّح صوتي (صوت) |
| sham-video-frames-audio-tokenizers | — | غير موجودة | — | مُرمِّزا صورة وصوت من مسار الفيديو — مرشّحان لمساري الصورة والصوت بحسب نوع كل ملف |
| sham-orchestrator-state | — | غير موجودة | — | حالة المُنسِّق (accelerator_state.json) — ملف حالة نصي صغير، لا أوزان فيه فلا يدخل الدمج |
| sham-keeper-state | — | غير موجودة | — | حالة حارس الدفتر الشامل (accelerator_state.json) — ملف حالة نصي صغير، لا أوزان فيه فلا يدخل الدمج |
| sham-crawl-selflearn | — | غير موجودة | selflearn | نسخة متعلّمة من تجارب أسئلة الويب (تُدمج تلقائياً عبر الإصلاح والبوابة كأي مصدر sham-crawl-*) |
| sham-crawl-selflearn-corpus | — | غير موجودة | selflearn | نصوص تجارب أسئلة الويب (تدخل خط النص ومرحلة المحادثة تلقائياً) |
| sham-text-shards | — | غير موجودة | token_shards | نوافذ نص جاهزة التقطيع (احتياط حين تتوقف مصادر الإنترنت في جلسة التدريب) |
| sham-crawl-modal | — | غير موجودة | modal_gpu | نموذج جلسات GPU على Modal (مرشّح لبوابة الدمج) |
| sham-grown-checkpoint | — | غير موجودة | model_grow | أفضل نقطة حفظ بالقياس بعد التكبير (طبقات أكثر وسياق أطول، الدالة محفوظة) — يفضّلها الدمج والمدرّب الحي عند التعادل |
| sham-image-tokenizer-v2-checkpoint | — | غير موجودة | lightning_probe | مُرمِّز الصورة v2 (128 بكسل، 64 رمزاً، يُدرَّب على CPU في استوديو Lightning) |
| sham-audio-tokenizer-v2-checkpoint | — | غير موجودة | lightning_probe | مُرمِّز الصوت v2 (كل مقاطع كل مقطع، يُدرَّب على CPU في استوديو Lightning) |
| sham-chat-arabic-sft-checkpoint | — | غير موجودة | arabic_sft | نقطة دفتر SFT العربي المنفصل (تدخل الدمج كمصدر عادي عبر قاعدة sham*) |
| sham-repair-remerge-checkpoint | — | غير موجودة | repair_remerge | ناتج أداة الاسترجاع والإصلاح وإعادة الدمج (تدخل الدمج كمصدر عادي عبر قاعدة sham*) |
| sham-runtime-creds | — | غير موجودة | any | مجموعة خاصة بملف اعتماد كاكل للنسخ المدفوعة بالواجهة (أسرار — لا تُرفق إلا بدفاتر خاصة؛ لا أوزان فيها) |
| sham-media-refined | — | غير موجودة | decoder_refine | مفكّ الصورة والصوت المصقول وحده (الترميز والقاموس كما هما بالضبط) — يُعتمد في الاستوديو فقط إذا طابق ترميز النموذج المدموج |

## آخر تقارير الجلسات (الأحدث أولاً)
### 2026-10-21 16:54 UTC — 🕸 الزاحف العام (GitHub): 95,641 وثيقة، 121.8 مليون حرف في 5.2 ساعة | crossref:61
```
🕸 الزاحف العام (GitHub): 95,641 وثيقة، 121.8 مليون حرف في 5.2 ساعة | crossref:61436 hackernews:32620 github:672 arxiv:448 ia_books:224 stackexchange:131 gutenberg:91 europepmc:19 | نُشر إلى jonsnowjonsnow/sham-crawl-gh-collect-corpus
```
### 2026-10-21 16:40 UTC — 🤖 مدرّب CPU على GitHub: 1,210 خطوة | نُشر: jonsnowjonsnow/sham-crawl-gh | نصوص: 
```
🤖 مدرّب CPU على GitHub: 1,210 خطوة | نُشر: jonsnowjonsnow/sham-crawl-gh | نصوص: jonsnowjonsnow/sham-crawl-gh-corpus | مؤشر الحارس 0.962
```
### 2026-10-21 13:39 UTC — 🧠 تقرير جلسة شام — البحث الذاتي المستمر (Track B)
```
🧠 تقرير جلسة شام — البحث الذاتي المستمر (Track B)
عدد الدورات: 22
مستندات جديدة مقبولة: 62
مستبعد (مكرر/شبه مكرر: 34، أسرار وكلمات مرور: 0)
خطوات تدريب حقيقية هذه الجلسة: 105 (الخطوة النهائية: 63,135)
آخر خسارة مسجّلة: 3.9913
نُشر إلى: jonsnowjonsnow/sham-research-track-checkpoint-v2
```
### 2026-10-21 12:45 UTC — 🧩 الدمج والتقييم على CPU (GitHub)
```
🧩 الدمج والتقييم على CPU (GitHub)
الأساس: sham-merged-checkpoint (يكمل من ناتجه السابق) (خطوة 61,555)
قبل: text=4.381, chat=2.955, media=8.343
بعد: text=4.381, chat=2.955, media=8.343
⏭ sham-multimodal-checkpoint: النقطة نفسها جُرّبت سابقاً (البصمة 118780c8)
📏 sham-chat-checkpoint (خطوة 73,475) وحده على الميزان: text=4.965, chat=3.351, media=8.677 | الأساس: text=4.381, chat=2.955, media=8.343
📏 sham-checkpoint (خطوة 61,853) وحده على الميزان: text=4.147, chat=3.548, media=12.092 | الأساس: text=4.381, chat=2.955, media=8.343
⏭ sham-cpu-track-checkpoint-v2: النقطة نفسها جُرّبت سابقاً (البصمة dbded48d)
⏭ sham-research-track-checkpoint-v2: ❌ لا توجد معه أداة تقسيم نص لمعرفة معنى صفوفه
⏭ sham-crawl-checkpoint: النقطة نفسها جُرّبت سابقاً (البصمة 46641583)
⏭ sham-crawl-agent: النقطة نفسها جُرّبت سابقاً (البصمة ba84359a)
📏 sham-crawl-gh (خطوة 62,634) وحده على الميزان: text=4.254, chat=3.824, media=8.883 | الأساس: text=4.381, chat=2.955, media=8.343
قبل الدمج: text=4.381, chat=2.955, media=8.343
❌ sham-chat-checkpoint (خطوة 73,475): لم يُدمج (لم يحسّن كل المهارات معاً) — أقرب محاولة (نسبة 0.05): text 4.381→4.391 (+0.2%), chat 2.955→2.963 (+0.3%), media 8.343→8.424 (+1.0%)
❌ sham-checkpoint (خطوة 61,853): لم يُدمج (لم يحسّن كل المهارات معاً) — أقرب محاولة (نسبة 0.05): text 4.381→4.349 (-0.7%), chat 2.955→2.958 (+0.1%), media 8.343→8.412 (+0.8%)
❌ sham-crawl-gh (خطوة 62,634): لم يُدمج (لم يحسّن كل المهارات معاً) — أقرب محاولة (نسبة 0.05): text 4.381→4.354 (-0.6%), chat 2.955→2.979 (+0.8%), media 8.343→8.414 (+0.8%)
⏭ sham-crawl-lightning: النقطة نفسها جُرّبت سابقاً (البصمة 180d5ec9)
⏭ sham-crawl-xlive: النقطة نفسها جُرّبت سابقاً (البصمة ef90815f)
📏 sham-chat-arabic-sft-checkpoint (خطوة 69,718) وحده على الميزان: text=4.558, chat=2.944, media=11.812 | الأساس: text=4.381, chat=2.955, 
```
### 2026-10-21 11:25 UTC — 🧠 تقرير جلسة شام — التدريب المستمر على المعالج المركزي (Track A)
```
🧠 تقرير جلسة شام — التدريب المستمر على المعالج المركزي (Track A)
خطوات تدريب حقيقية هذه الجلسة: 326 (الخطوة النهائية: 63,356)
متوسط الخسارة أول 10 خطوات: 3.7295
متوسط الخسارة آخر 10 خطوات: 3.7687
(كل رقم منهما دفعة واحدة، يتأرجح بنحو ±1.5 وحده — الحَكَم هو القياس على نص لم يُدرَّب عليه أدناه)
📏 على نص لم يُدرَّب عليه: قبل 3.669 → بعد 3.598 (-0.071)
🛡 الحارس: نهاية الجلسة كانت أسوأ على النص غير المرئي (3.824) فاستُعيدت أفضل أوزان وُجدت (بعد 100 دفعة، 3.598) ولم تُنشر الأوزان الأسوأ.
خسارة التدريب في آخر 50 خطوة: 3.780
نُشر إلى: jonsnowjonsnow/sham-cpu-track-checkpoint-v2
```
### 2026-10-21 10:18 UTC — 🤖 مدرّب CPU على GitHub: 1,079 خطوة | نُشر: jonsnowjonsnow/sham-crawl-gh | نصوص: 
```
🤖 مدرّب CPU على GitHub: 1,079 خطوة | نُشر: jonsnowjonsnow/sham-crawl-gh | نصوص: jonsnowjonsnow/sham-crawl-gh-corpus | مؤشر الحارس 0.770
```
