# نشر خادم ModelScope تلقائياً

كل ملف في هذا المجلد يُنسخ تلقائياً إلى مستودع Git الخاص باستوديو
ModelScope (`novaai2026/nova-inference-server`) فور دفعه على هذا
الفرع — عبر `.github/workflows/deploy-modelscope-studio.yml`، الذي
يعمل على خوادم GitHub نفسها (تصل modelscope.cn بلا مشكلة، بخلاف بيئة
التطوير وبخلاف شبكة بناء ModelScope نفسها التي لا تصل github.com).

لا حاجة لأي رفع يدوي عبر الهاتف بعد الآن لهذا الاستوديو تحديداً —
فقط عدّل الملفات هنا وادفعها لـGit كالعادة.

**ملف `llama_cpp_python-*.whl`** (نسخة JamePeng المبنية لدعم رؤية
Qwen2.5-VL) يجب أن يوضع في هذا المجلد أيضاً بمجرد بنائه على Kaggle
(انظر `ai-system/colab/merge_and_finetune.ipynb` وسجل المحادثة —
يجب أن يطابق Python 3.12 / Ubuntu 22.04 / glibc 2.35 تحديداً، نفس
بيئة هذا الاستوديو، وإلا فسيفشل التحميل بخطأ "GLIBC not found").
