# جرد حوسبة ModelScope لتدريب قلم (2026-11-28، قراءة فقط)

المصدر: سير عمل `modelscope-studios-list` للحسابين (cn: التشغيلان `46149540786`، ai: `46149543510`) والأدوار من `docs/STUDIOS.md` و`WORK_BOARD.md`. لم يُغيَّر شيء ولم تُطبع أسرار. **لا يبدأ أي تدريب قبل اعتماد قلم النهائي.**

## ما تقوله القائمة وما لا تقوله
القائمة تعطي **الحالة والعتاد فقط** (Running / Sleeping / Stopped). لا تقول إن كان الاستوديو «فارغًا». «نائم» يعني غير مُنادى الآن لا أنه بلا محتوى. التأكد من الفراغ الفعلي يحتاج جرد التطبيق نفسه (قيد القراءة) أو موافقتك. والعتاد: **كل استوديو cn بمعالجين و8 GB، وكل استوديو ai بمعالجين و16 GB، بلا GPU في أي منها.**

## الحساب cn (novaai2026): 31 استوديو
**أ) مستخدم أو محجوز: لا يُمَسّ** (14)
| الاستوديو | الحالة | الدور |
|---|---|---|
| coder-inference-server، -2، -3 | Running | نوفا؛ و-3 مدرّب الحركة، و-2 مدرّب شام برو T-LDM (من لوحة العمل) |
| nova-media-server | Running | وسائط نوفا |
| sham-v1-server | Running | شام v1 |
| sham-v2-server، sham-v2-overflow-server | Running | شام v2 |
| sham-trainer-1 | Running | مدرّب شام (cn، دورة 6 ~87.9k خطوة) |
| nova-inference-server (16 GB) | Sleeping | **حاسوب مركزي محجوز؛ ممنوع لمسه** (قاعدة المالك) |
| epicrealism-image-test | Running | مرتبط بنشر v1 (`redeploy-studio` يقبل `epicrealism-*` فقط) |
| sham-donor-gemma4-e4b-test، sham-donor-minicpmo45-test، sham-donor-qwen35-9b-test | Running | مرشَّحات مانح شام (تُنادى حاليًا) |

**ب) نائمة بدور مسجَّل (قد تُستعمل): اسأل قبل نقلها** (9)
coder-inference-server-4 و-5 (نسختان احتياطيتان لنوفا) · sham-trainer-tools · sham-trainer-nb1 · sham-tldm-writer · sham2-tldm · sham-v2-video-server (مدرّب 6، مرمّز صور) · lfm25-inference-server · lfm25-media-server · nova-computer-hub (اسم غير مذكور في الوثائق)

**ج) مرشَّحة لقلم: بقايا تجارب صور/مانح** (8): هذه تُنسب إلى تجارب انتهت أو معلّقة، ولا ذِكر لدور حي لها في الوثائق
| الاستوديو | الحالة | ملاحظة |
|---|---|---|
| cyberrealistic-final-test | **Stopped** | الأوضح فراغًا |
| umranz-sd15-image-test | **Stopped** | الأوضح فراغًا |
| gemma4-realistic-vision-v6-test | **Stopped** | الأوضح فراغًا |
| realistic-vision-v6-test | Sleeping | تجربة صور |
| juggernaut-ragnarok-image-test | Sleeping | الوثائق: «تجربة صور منفصلة» |
| sham-donor-gemma4-e4b-media، sham-donor-minicpmo45-media، sham-donor-qwen35-9b-media | Sleeping | أزواج وسائط للمانحين |

## الحساب ai (Jonjithup): 4 استوديوهات (كلها 2 معالج و16 GB)
| الاستوديو | الحالة | الدور |
|---|---|---|
| coder-inference-server-16 | Running | تجربة نوفا 35B (T-LDM مطفأ فيه) |
| sham-trainer-2 | Running | **حاسوب نوفا المركزي** (16 GB) |
| nova-tldm-reader | Running | قارئ T-LDM لنوفا (أُنشئ بعد ملاحظتي الأخيرة؛ لا ذِكر له في STUDIOS.md بعد) |
| sham-runner-1 | Running | غير مذكور في الوثائق التي قرأتها: **دوره مجهول، اسأل** |
**لا استوديو فارغ في ai،** وسقف الحساب كان 5/5 (يظهر الآن 4).

## الخلاصة والتوصية
- **الأقوى مرشحًا لقلم الآن:** الثلاثة Stopped في cn (cyberrealistic-final-test وumranz-sd15-image-test وgemma4-realistic-vision-v6-test)، ثم الخمسة النائمة في الفئة ج. بحد أقصى ~8 استوديوهات cn بمعالجين و8 GB.
- **حدود واقعية:** بلا GPU، المعالجان أبطأ من هذا الجهاز (274 رمز/ث لـ`base`)، ولا مزامنة تدرّج بين الاستوديوهات (لا تدريب موزَّع). المتاح: **تجارب مستقلة** (مثل تدريب `small` على مراحل مختلفة، أو تقييم محجوز)، لا تدريب `base` الكبير. وهذا يحتاج مصدر GPU (قرارك المنتظر).
- **قبل التخصيص أحتاج:** (1) تأكيدك أن الفئة ج متروكة، (2) جردًا أعمق لمحتوى الاستوديوهات الثمانية (قيد التشغيل، قراءة فقط)، (3) حدّ ما إذا كانت الاستوديوهات النائمة تستيقظ تلقائيًا أو يدويًا.
