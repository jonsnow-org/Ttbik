# توسيع بيانات Sham Intelligence Lab — تسليم المهندس

## ما أُضيف

1. **بيانات معلم أصلية كتبها GPT-6 في هذه الجلسة:** `data/samples/gpt6_teacher_seed.jsonl`. هذه استجابات حقيقية ولّدها النموذج هنا وليست أمثلة وهمية أو مقتطفات من API غير موجود. هي مجموعة أولية متنوعة في العربية العامة والحساب والاستدلال والأدلة والبرمجة وعدم اليقين والإصلاح. كل سجل يحمل هوية المعلم ووسم `reviewed=false` و`verification_status=pending`؛ أي أنها لا تدخل التدريب تلقائياً.
2. **عينة بشرية خارجية:** `data/samples/aya_human_arabic_sample.jsonl`، مقتطف معاينة من سجلات Aya البشرية، وليس بديلاً عن تنزيل المجموعة الكاملة.
3. **أمثلة جاهزة لمخرجات معلم:** `data/samples/teacher_outputs_public_sample.jsonl`، مقتطفات عربية من Arabic-OpenHermes وJais-3 QA. تُحفظ نسبتها إلى مصدرها ولا تُعامل كإجابات متحققة تلقائياً.
4. **فهرس مصادر كبيرة:** `data/catalog/dataset_sources.json`، يسجل المعرفات والأحجام والتقسيمات والغرض المقترح ودرجة الأولوية. لا يحتوي على أحكام قانونية؛ يضيفها مالك المشروع والمهندس بعد المراجعة.
5. **مستورد متدفق:** `tools/import_hf_sources.py`. يستخدم `datasets` ويدعم السحب على دفعات أو بث المجموعة كاملة؛ لا يحتاج إلى تحميل مجموعة من عشرات الجيجابايت دفعة واحدة.

## أحجام ومصادر ذات أولوية

- **IFM/Jais-3-Data:** 57.3 مليون سجل تقريباً و23.8 مليار رمز موزعة على نص عربي خام، ومقاطع سؤال/جواب، ومحادثات SFT، وإعادة صياغة أسلوبية. هذا أفضل مصدر عربي شامل وجدته للمرحلة الحالية.
- **CohereLabs/aya_dataset:** نحو 204 آلاف زوج تعليمات/إجابة موسوم بأنه بشري التعليق عبر لغات متعددة. على المهندس تصفية رموز العربية فقط عند الاستيراد.
- **CohereLabs/aya_collection_language_split:** مجموعة متعددة اللغات ضخمة، وبها تقسيمات عربية فصحى ولهجية تصل عدة ملايين من الصفوف لكل تقسيم كبير. محتواها مختلط بين مترجم ومقولب ومهام مختلفة؛ لا تسمّ كل السجلات محادثات بشرية.
- **2A2I/Arabic-OpenHermes-2.5:** نحو 981.6 ألف سجل عربي من نمط المستخدم/المساعد؛ مفيد لمخرجات المعلم والتعليمات وليس مصدراً للمحادثات العضوية.
- **ClusterlabAi/101_billion_arabic_words_dataset:** نحو 33.1 مليون صف و96.1 جيجابايت حسب بنية المستودع، والعنوان يعلن 101 مليار كلمة. مصدر حجم ضخم للنص الخام، يحتاج تنظيفاً وإزالة تكرار صارمة.
- **ArabicText-Large:** نحو 743 ألف مقالة و244 مليون كلمة.
- **OpenR1-Math-220k وMixture-of-Thoughts:** مخرجات منسوبة إلى DeepSeek-R1، وتغطي الرياضيات والبرمجة والعلوم. لا ننسخ مسارات التفكير المطولة؛ نستورد الإجابة النهائية والبيانات التي يمكن التحقق منها.
- **Tiny Aya Arabic reasoning:** نحو 23 ألف سجل تدريب عربي؛ بطاقة المجموعة تنسب التوليد إلى gpt-oss-120b وتذكر ترجمة آلية متعددة المراحل.
- **UltraChat 200k / OpenHermes 2.5:** مصادر تعليم ومحادثة مولّدة بالمعلم بالإنجليزية؛ تضيف تغطية عامة ولكنها لا ينبغي أن تطغى على العربية.
- **SmolLM-Corpus / FineWeb-Edu / Cosmopedia:** مصادر ضخمة للنص التعليمي والبرمجي، معظمها إنجليزي؛ Cosmopedia بيانات اصطناعية وليست نصاً طبيعياً بشرياً.

## تنزيل واستيراد

من جذر المستودع:

```bash
pip install datasets

# 1) نص عربي خام — 10,000 صف كتجربة محدودة
python ai-system/colab/sham_small/intelligence_lab/tools/import_hf_sources.py \\
  --source jais3_cc --max-records 10000 \\
  --output /tmp/sil-data/jais3_raw_arabic.jsonl

# 2) محادثات Jais-3 SFT — 5,000 محادثة/صف مصدر
python ai-system/colab/sham_small/intelligence_lab/tools/import_hf_sources.py \\
  --source jais3_sft --max-records 5000 \\
  --output /tmp/sil-data/jais3_teacher.jsonl

# 3) أزواج Aya البشرية، مع الاحتفاظ بالعربية فقط
python ai-system/colab/sham_small/intelligence_lab/tools/import_hf_sources.py \\
  --source aya_human --max-records 100000 \\
  --output /tmp/sil-data/aya_arabic_human.jsonl

# 4) مخرجات Arabic-OpenHermes
python ai-system/colab/sham_small/intelligence_lab/tools/import_hf_sources.py \\
  --source arabic_openhermes --max-records 10000 \\
  --output /tmp/sil-data/arabic_openhermes_teacher.jsonl

# 5) مقاطع نصية + سؤال وجواب من Jais
python ai-system/colab/sham_small/intelligence_lab/tools/import_hf_sources.py \\
  --source jais3_qa --max-records 10000 \\
  --output /tmp/sil-data/jais3_qa_teacher.jsonl

# 6) تقسيم عربي لهجي من Aya Collection (مثال: الشامي الشمالي)
python ai-system/colab/sham_small/intelligence_lab/tools/import_hf_sources.py \\
  --source aya_collection_config --config north_levantine_arabic \\
  --max-records 10000 --output /tmp/sil-data/aya_levantine.jsonl
```

`--max-records 0` يعني بث التقسيم كاملاً. لا أنصح بذلك قبل تجربة دفعة صغيرة وفحص حجم التخزين وجودة الصفوف. كل مستورد ينشئ ملف تقرير `.report.json`.

## الفروقات التي يجب الحفاظ عليها

- **نص خام:** ملفات `record_type=raw_corpus` لا تدخل مباشرة في SIL SFT pipeline؛ تحتاج إلى مسار pretraining/text packing مستقل.
- **Natural SFT بشري:** Aya Human يذهب إلى `source_kind=natural` بعد تصفية العربية ومراجعة المصدر.
- **Teacher outputs:** Jais SFT وJais QA وArabic-OpenHermes وTiny Aya وOpenR1 تظل في صيغة المعلم `teacher_id`، وكلها `reviewed=false` حتى يراجعها المهندس.
- **Synthetic:** Cosmopedia وبيانات GPT-6 التي كتبتها في `gpt6_teacher_seed.jsonl` بيانات مولدة؛ لا تصنف على أنها محادثات بشرية طبيعية.
- **اختبار / تقييم:** لا تستورد ملفات test/validation إلى ملفات train أو إلى المعلم أو إلى التوليد. أبقِ التقسيم الأصلي مسجلاً ومجمداً.

## طريقة ربطها بمهيّئ SIL الحالي

بعد مراجعة ملفات المعلم وإقرار سجلات بعينها فقط، يمكن تمرير JSONL للمعلم إلى `--teacher-jsonl`. لا تغيّر `reviewed` يدوياً بالجملة. المطلوب ملف موافقات منفصل أو سكربت مراجعة ينتج manifest دقيقاً بالسجلات التي اجتازت التحقق.

أما ملف Aya الطبيعي، فيمرر إلى `--natural-jsonl` بعد التصفية والمراجعة. النص الخام يبقى منفصلاً ولا يمر عبر خيار `--natural-jsonl` لأنه لا يمثل زوج prompt/target.

## ملاحظات جودة مهمة

- مخرجات المعلم ليست حقائق لمجرد أن نموذجاً أنتجها؛ اختبر كل مهمة بمدقق مستقل أو مرجع موثوق.
- لا تستخدم الثقة الذاتية التي يذكرها المعلم كحقيقة. أبقِ بيانات الثقة مميزة عن نتيجة التحقق.
- تجنب نقل سلاسل التفكير الداخلية المطولة. استورد الإجابة النهائية وملخص حل موجز قابل للتحقق فقط.
- أزل التكرار الدقيق والقريب، وافحص التلوث مع اختبارات التقييم.
- لا تدمج مجموعات العربية المترجمة والمقولبة مع بيانات المحادثة البشرية في فئة واحدة.
- هذه الإضافة لا تدرب Sham v1 ولا تستورد أوزانه ولا تعدل مساراته الحية.
