# sham_boost — إضافات اختيارية لشام ببوابات صفرية

مجلد منفصل بالكامل. لا يعدّل `model.py` ولا `train.py` ولا الدفاتر ولا الدمج ولا أي إعداد. كل وحدة جديدة تُضرب في `tanh(g)` حيث `g = 0` عند البداية، فيبقى ناتج شام **مطابقاً حرفياً** لما هو عليه الآن (يتحقق منه `verify_boost.py`). التدريب يفتح البوابة فقط بقدر ما تتحسن الخسارة. العمل كله على المعالج (CPU).

## الملفات

| الملف | الدور |
|---|---|
| `sched.py` | جدول سرعة تعلّم: إحماء قصير ← سرعة ثابتة ← نزول في آخر كل جلسة، مربوط بالخطوة الكلية ويُستأنف بدقة. بديل للجدول الحالي الذي يُستأنف وهو منتهٍ تقريباً (~98%) فيدرّب على الحد الأدنى 3e-5. |
| `data_stream.py` | قراءة نص جديد مع حفظ موضع القراءة بين الجلسات (`SHAM_BOOST_DOCS_PER_SESSION`، افتراضياً 25000)، رصّ المستندات بلا حشو مع منع الانتباه عبر حدود المستند، وخلط نص عالي الجودة في مرحلة النزول. |
| `modules.py` | `GatedQKNorm`، `z_loss`، `GatedEmbedAdapter` (جدول إضافي للكلمات النادرة)، `GatedCrossAttnMemory` (ذاكرة مبنية من تمثيلات شام نفسه)، `GatedMediaBridge` (مُرمّز صغير خاص للصور والصوت والفيديو يُدرَّب من الصفر)، `ShortLongContext` (سياق قصير أغلب الوقت). |
| `boosted.py` | `BoostedSham`: يحمّل نقطة حفظ شام كما هي + `boost_state.pt` اختيارياً. `fold_in()` يكتب ملفاً **جديداً** ويرفض الكتابة فوق `final_merged.pt`. |
| `train_boost.py` | المرحلة A: تجميد شام وتدريب الإضافات فقط. المرحلة B (`--unfreeze`): فك التجميد بسرعة أقل لأوزان شام. |
| `verify_boost.py` | فحص آلي على نموذج صغير عشوائي. |
| `one_click_merge.py` | تقييم بنفس ميزان الدمج الحالي، والدمج بأمر واحد فقط إن لم تسوء أي مهارة. |

## الاستخدام

```bash
cd ai-system/colab/sham_small

# 1) الفحص (ثوانٍ)
python sham_boost/verify_boost.py

# 2) تدريب المرحلة A (شام مجمّد)
python -m sham_boost.train_boost --ckpt /kaggle/working/final_merged.pt \
    --tokenizer /kaggle/working/tokenizer.json --text-dir <نصوص> --hq-dir <نص نظيف> \
    --out /kaggle/working/boost --steps 2000 --lr 1e-3 --memory-layers 6,13,19

# 3) التقييم فقط (لا يكتب شيئاً)
python -m sham_boost.one_click_merge --ckpt /kaggle/working/final_merged.pt \
    --boost /kaggle/working/boost/boost_state.pt --tokenizer /kaggle/working/tokenizer.json

# 4) الدمج بأمر واحد إن نجح الفحص (ملف جديد)
python -m sham_boost.one_click_merge ... --apply --out /kaggle/working/final_boosted.pt
```

- حدّ السماح الافتراضي `--tolerance 0.005` هو نفس حارس الدمج الحالي؛ يمكن تخفيفه (مثلاً `0.015`) بقرارك.
- `final_boosted.pt` يُقرأ بـ `BoostedSham.from_merged()`. و`checkpoint.load_checkpoint()` العادي يقرأ نفس الملف ويعيد شام الأساسي فقط (الإضافات تحت `extra["boost"]`).
- الذاكرة: `model.build_memory(chunks)` ثم `model.set_memory_bank(bank)`؛ تُبنى من تمثيلات شام في الطبقة الوسطى، وتُحفظ بـ `bank.save()`.
- الوسائط: `model(ids, media={"image": px, "audio": mel, "video": frames})`. توكنات الصور والصوت الحالية لا تتغير.

## حجم الإضافات عند d768 و21 طبقة
- تثبيت q/k لكل الطبقات: ~2.7 ألف بارامتر.
- محوّل الكلمات (4000 كلمة، رتبة 128): ~0.6 مليون.
- ذاكرة على 3 طبقات: ~7.1 مليون.
- جسر الوسائط (قراءتان): ~7.8 مليون.

## ملاحظات
- لا يوجد أي رد ثابت أو نص جاهز؛ شام يكتب كل كلمة.
- لا شيء هنا يُشغَّل تلقائياً، ولا يرتبط بأي دفتر حالياً. القرار للمهندس.
