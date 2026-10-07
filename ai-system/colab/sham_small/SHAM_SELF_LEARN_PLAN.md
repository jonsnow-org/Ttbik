# شام — حلقة التعلّم الذاتي / Sham Self-Learning Loop

**فرع العمل:** `sham-main` فقط · **المستودع:** `jonsnow-org/Ttbik` · **المالك:** عربي

## الهدف / Goal
حلقة حية: بحث إنترنت → إجابة (نص/وسائط حسب الحاجة) → تحويل أزواج سؤال/جواب موثوقة إلى خطوة تحديث أوزان → حفظ نقطة جديدة دون لمس `final_chat.pt`.

Live loop: internet search → answer → convert trusted Q/A into one weight update → save a **new** checkpoint (never overwrite `final_chat.pt`).

## المعمارية / Architecture
```
Telegram/web client
       │  POST /ask/web  {question, learn?, max_new_tokens?}
       ▼
serve.py  ──search──►  self_learn.search_hits()   (إعادة استخدام sham_decoding.web_search_text / ddgs)
       │
       ├── توليد إجابة مع سياق المصادر (generate_tokens + سياق بحث)
       │
       └── إن learn=true و SHAM_SELF_LEARN=1 ونتائج بحث موجودة:
             self_learn.learn_from_turn()  →  خطوة AdamW خفيفة على طبقات أخيرة فقط
             save_checkpoint(SHAM_SELF_LEARN_SAVE_PATH) + نسخة tokenizer بجانبها
```

- **ليست LoRA منفصلة:** خطوة fine-tune خفيفة على الطبقات الأخيرة + `lm_head` (أقل ذاكرة، نفس تنسيق `checkpoint.py`).
- **ليست شجرة موازية:** إضافة `self_learn.py` + تمديد `serve.py` + أمر بوت خفيف؛ إعادة استخدام `sham_chat.build_chat_example` / `sham_decoding.web_search_text` / `checkpoint.save_checkpoint`.
- **مسارات طبية تبقى:** لا حذف `medical_dataset.py` ولا بوابات فئات/مفاتيح org.

## ملفات تُلمس / Files to touch
| ملف | تغيير |
|-----|--------|
| `ai-system/colab/sham_small/self_learn.py` | **جديد** — بحث، دفعة تدريب، خطوة واحدة، حفظ |
| `ai-system/colab/sham_small/serve.py` | `POST /ask/web` (+ حالة تعلّم في `/health`)؛ الإبقاء على كل المسارات الحالية |
| `ai-system/colab/sham_small/web/telegram_bot.py` | أمر `/web` يستدعي `/ask/web` |
| `ai-system/colab/sham_small/SHAM_SELF_LEARN_PLAN.md` | هذه الخطة |

لا تُلمس: Athar / Nova / main / marketplace / `medical_dataset.py`.

## خطوة التدريب / Training step
1. بناء مثال حوار عبر `sham_chat.build_chat_example(user_ids, answer_ids)` (صيغة USER_TURN/SHAM_TURN).
2. تجميد كل الطبقات عدا آخر `SHAM_SELF_LEARN_UNFREEZE_LAYERS` (افتراضي 2) و`lm_head` و`final_norm`.
3. AdamW (`train.build_optimizer`) بمعدل تعلم صغير (`SHAM_SELF_LEARN_LR`، افتراضي `1e-5`).
4. دفعة واحدة (batch=1)، تسلسل مقصوص (`SHAM_SELF_LEARN_MAX_SEQ`، افتراضي 256).
5. `save_checkpoint` → مسار جديد؛ نسخ `sham_small_tokenizer.json` بجانبه إن وُجد.

## الوسائط المتعددة / Multimodal
- **نص + بحث:** كامل في MVP (`/ask/web`).
- **صورة/فيديو ask:** المسارات الحالية تبقى؛ التعلّم منها **مُعطّل عمداً** (الملفات لا تُخزَّن ولا تُدرَّب عليها — سياسة serve الحالية).
- إدخال عيّنات وسائط للتدريب يبقى عبر مسارات track_b / sham_chat الموجودة (ليس عبر رفع المستخدم الحي).

## السلامة / Safety
- **لا كتابة فوق** `final_chat.pt` أبداً. الافتراضي: `final_chat_self.pt` أو مسار `SHAM_SELF_LEARN_SAVE_PATH`.
- التعلّم يتطلب: `SHAM_SELF_LEARN=1` + `learn=true` + نتائج بحث غير فارغة.
- رفض المسارات التي تنتهي بـ `final_chat.pt` / `final.pt` بدون لاحقة `_self`.
- قفل بسيط أثناء خطوة التعلّم حتى لا تتداخل طلبات متزامنة.

## متغيرات البيئة / Env
| متغير | معنى |
|--------|------|
| `SHAM_SELF_LEARN=1` | تفعيل حلقة التعلّم |
| `SHAM_SELF_LEARN_SAVE_PATH` | مسار النقطة الجديدة (افتراضي: `final_chat_self.pt`) |
| `SHAM_SELF_LEARN_LR` | معدل التعلّم (افتراضي `1e-5`) |
| `SHAM_SELF_LEARN_UNFREEZE_LAYERS` | عدد الطبقات الأخيرة (افتراضي `2`) |
| `SHAM_SELF_LEARN_MAX_SEQ` | أقصى طول تسلسل (افتراضي `256`) |
| `SHAM_SMALL_CHECKPOINT_PATH` / `SHAM_SMALL_TOKENIZER_PATH` | كما في serve الحالي |

## Telegram / البوت
```
/web ما ارتفاع جبل قاسيون؟
→ POST /ask/web {"question":"...", "learn": false}
/weblearn سؤال...
→ learn=true (إن كان SHAM_SELF_LEARN=1 على الخادم)
```

## معايير النجاح MVP / Done when
- [x] خطة مكتوبة
- [x] `self_learn.py` + `/ask/web` يعملان محلياً
- [x] smoke: خطوة واحدة دون OOM على final_chat.pt
- [x] دفعة واحدة إلى `sham-main` برسالة واضحة
