# سجل دفاتر كاكل ومخرجاتها (ملاحظة ثابتة)

آخر جرد مقروء: 2026-11-23 07:44 UTC من سجل `sham-kaggle-inspect` (تشغيل 45132593431). الحساب: `jonsnowjonsnow` على Kaggle.
الرابط: `https://www.kaggle.com/code/jonsnowjonsnow/<الاسم>`. يُجدَّد هذا الجرد بتشغيل `sham-kaggle-inspect.yml` (قراءة فقط، يطبع الأسماء الحقيقية)؛ والمراقب `sham-restarter.yml` يطبع الاسم والرابط أيضًا.

## الدفاتر المعتمدة (هي وحدها المراقَبة والمدفوعة)
| الدفتر | الدور | النموذج | الحالة (2026-11-23) | المخرَج |
|---|---|---|---|---|
| `notebook3-8` | الشامل `all_in_one` (المدرّب الحي + المرحلة 1 + 2): يدرّب الرأس المنشور | شام (v1) | **ERROR** منذ آخر تشغيل 2026-11-22 21:02 (CPU) | `sham-checkpoint` (v47، 4.24 GB) ثم الدمج `sham-merged-checkpoint` (v156) |
| `notebook` | `chat_image_in_one`: المحادثة + المرمّزات (صورة/صوت) | شام (v1) | RUNNING (CPU، بدأ 03:24) | `sham-chat-checkpoint`، `sham-image-tokenizer-checkpoint`، `sham-audio-tokenizer-checkpoint` |
| `notebooka-bshamel` | `ab_in_one`: المسار A (نص CPU مستمر) | شام (v1) | RUNNING (CPU، بدأ 01:14) | `sham-cpu-track-checkpoint-v2` (v104) |

المسار B (البحث الذاتي) أُوقف 2026-11-15؛ مخرجه `sham-research-track-checkpoint-v2` مرفوض دائمًا ولا يُستعمل.

## دفاتر شام برو (v2) — تُدفع بسير `sham-v2-stages-push` وليست من المراقب
`sham-v2-train`، `sham-v2-tools-train`، `sham-v2-media-train`، `sham-v2-candidate-train` (GPU)، `sham-v2-candidate-tools-train`: كلها الآن ERROR أو ملغاة (آخر تشغيل 2026-11-13 إلى 2026-11-23). تدريب شام برو الفعلي يجري على استوديوهات ModelScope (cn) لا على كاكل؛ هذه الدفاتر ثانوية.

## دفاتر مساعدة وأدوات
| الدفتر | الغرض |
|---|---|
| `sham-arabic-sft` | محادثة عربية SFT → `sham-chat-arabic-sft-checkpoint` (ERROR 2026-11-23 01:14) |
| `sham-repair-remerge` | إعادة الدمج وإصلاح الأوزان → `sham-repair-remerge-checkpoint` (ERROR 01:24) |
| `notebookc` | مركز تحكم شام (أداة) |
| `noteb` | تجربة بوت شام (أداة، ملغى) |
| `notebooke` | المدرّب الحي القديم (GPU، اكتمل 2026-10-10) |
| `noteb-1` | جمع وترميز الفيديو → `sham-video-corpus` (اكتمل 2026-10-01) |
| `notebook191ae3482b` | مرمّز الصورة VQ-VAE (اكتمل 2026-10-12) |
| `notebook2f4c6f2435` | مرمّز الصوت VQ-VAE (ERROR منذ 2026-10-11) |
| `notebook4891fd4182` | المسار A القديم `cpu_training_track` (اكتمل 2026-10-12) |
| `note1` | المرحلة 1 `text_stage1` (اكتمل 2026-10-10) |
| `sham-2` | المرحلة 2 `stage2_multimodal` (اكتمل 2026-09-23) |
| `notebooke5` | المرحلة 3 `chat_stage` (اكتمل 2026-10-02) |
| `nova1-coder` | دفتر نوفا 1 القديم (4B محذوف نهائيًا؛ ERROR منذ 2026-10-31) — لا يُستعمل |

## قديم/مكرر — يُتجاهل (لا يُحذف شيء دون إذن المالك)
نسخ مكررة من المسارات: `notebook24ffaf0b22`، `notebookb85993aa78` (صوت)، `noteb5`، `notebo-2`، `notebook-82c` (محادثة)، `notebook04b758ffb5`، `notebookff914258b5` (صورة)، `netbook1` (المرحلة 2)، `notebook2d0e40c1f1` (المرحلة 1). ودفاتر ليست من شام: `notebook070a85ff37`، `notebook180970a442`، `notebook7ea3068ad4`، `notebook9dd95599ae`، `notebookd02c43afba`؛ ومن دفاتر المهندس: `notebook8`، `notebookc888d4c48c`.

## مخرجات (مجموعات بيانات) وأماكنها
| المجموعة | المحتوى | آخر نسخة | يخص |
|---|---|---|---|
| `sham-checkpoint` | نقطة تدريب المرحلة 1 | v47 (2026-11-23 06:16) | شام v1 |
| `sham-merged-checkpoint` | الرأس المدموج المنشور (نسخة ModelScope `sham-merged`) | v156 (07:13) | شام v1 |
| `sham-cpu-track-checkpoint-v2` | المسار A | v104 (01:08) | شام v1 |
| `sham-crawl-checkpoint` / `-gh` / `-ms3` / `-nb1` / `-ms2` | مخرجات الزحف والمدرّبين (ms3 على cn يتحدّث) | v167 / v264 / v66 / v38 / v19 | شام v1 |
| `sham-chat-checkpoint`، `sham-chat-arabic-sft-checkpoint` | المحادثة | v62 (2026-11-08)، v24 (2026-10-27) | شام v1 |
| `sham-image-tokenizer-checkpoint` / `sham-audio-tokenizer-checkpoint` | المرمّزات | v73 / v71 (2026-11-08/07) | شام v1/v2 |
| `sham-multimodal-checkpoint` | المرحلة 2 | v32 (2026-11-05) قديم | شام v1 |
| `sham-video-corpus` | فيديو | v73 (2026-11-08) | شام |
| `sham-repair-remerge-checkpoint` | إصلاح الدمج | v145 (2026-11-08) | شام v1 |
| `sham-research-track-checkpoint-v2` | المسار B (مرفوض) | v76 | — |
| `sham-keeper-state`، `sham-reports`، `sham-runtime-creds` | حالة المراقب والتقارير والأسرار (لا تُطبع) | — | البنية |
| `sham-media-audio-2026101*` / `sham-media-image-2026101*` | لقطات قديمة (2026-10-11) | v1 | قديمة — تُتجاهل |

## أين يعمل كل شيء (غير كاكل)
- **ModelScope cn (المدرّبون):** `coder-inference-server-2` (اسم النشر `sham2-cn2`، تدريب T-LDM لشام برو)، `coder-inference-server-3` (`motion-cn3`، حركة/فيديو)، و`sham-trainer-1` (cn). النشر: `deploy-sham-trainer-studio.yml`، الحالة: `sham-trainer-status.yml`.
- **ModelScope ai (دولي):** استوديوهات الخدمة: شام v1 وشام برو (`sham-v2-server`) ونوفا (35B) ومركز الحاسوب `nova-inference-server` (16 GB، لا يُمسّ).
- **Lightning / Modal / GitHub (`sham-crawl-gh`):** تعمل بسير عمل `sham-lightning.yml` و`sham-modal.yml` وجامع GitHub `sham-collector.yml`.
- **الحالة والأسرار:** المراقب يحفظ حالته في `sham-keeper-state`؛ لا تُطبع الأسرار أبدًا.

## إصلاح 2026-11-23 (07:50 UTC، تشغيل `sham-restarter` حي على فرع `sham-main`، رقم 45133956021)
- أُعيد دفع ثلاثة دفاتر كانت ERROR، كلها على CPU لأن حصة GPU الأسبوعية (30 ساعة) مستنفدة وتُجرَّب GPU مجددًا بعد 24 ساعة: الدفتر 1 (الشامل `all_in_one`)، والدفتر 3 (`sham-v2-train`)، والدفتر 6 (`sham-repair-remerge`).
- الدفتران 2 و4 يعملان؛ الدفتر 5 في مهلة قبل إعادة التشغيل. «نوفا 1» متوقف عمدًا (4B محذوف).
- لم أقرأ سبب فشل الدفتر الشامل: سجل كاكل ردّ 429 (حدّ الطلبات) مرتين. تذكير كاكل: تحقق في واجهة كاكل أن الأسرار (GITHUB_TOKEN وKAGGLE_USERNAME وKAGGLE_KEY) ما زالت مرفقة بعد كل دفع.
- ملاحظة: تشغيل المراقب الحي من الفرع الأصلي فشل في المصادقة (07:48)، ونجح من `sham-main`؛ السبب لم يُحسم.

## قرار المالك 2026-11-23: توزيع المنصات
- **كاكل: لشام الأصلي فقط.** رؤوس وتدريب شام برو ونوفا (المهم) على ModelScope الصينية. أُزيل `sham-v2-train` من مراقبة المراقب ودفعه (دفاتر شام برو على كاكل لم تعد مراقَبة).
- **ليثنينك (فحص 2026-11-23 08:40):** `Authentication failed. Please run lightning login` — مفاتيح LIGHTNING_* في أسرار المستودع غير صالحة؛ يلزم مفتاح جديد من المالك. الرابط: https://lightning.ai
- **GitHub:** `sham-cpu-trainer.yml` (كل 6 ساعات، تشغيل 151 جارٍ منذ 07:21 UTC، 7 من آخر 12 نجحت)، `sham-collector.yml` (كل 6 ساعات)، `sham-crawl-gh` مخرج الزحف (v264).
- **كاكل سجل الأخطاء:** نقطة `ListKernelSessionOutput` تردّ 429 باستمرار، فلا يمكن قراءة سبب فشل الدفاتر 1 و6 من هنا؛ يُقرأ من واجهة كاكل.
