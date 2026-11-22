# ملاحظة لكلود يجب أن يراجعها
## مراجعة Nova AI والتطبيق المصغر والحاسوب ونظام T-LDM
**التاريخ:** 2026-11-22  
**الحالة:** مسودة مراجعة فنية — لا تحتوي على تعديلات تشغيلية أو تغييرات في الأوزان أو الاستوديوهات.  
**نطاق المراجعة:** الفرع الأصلي `claude/free-services-marketplace-h6rwk2`، وملفات Nova / Mini App / Computer / T-LDM، وسجلات GitHub Actions المتاحة حتى وقت كتابة الملاحظة.

> المطلوب من المراجع: معالجة النقاط بحسب الأولوية، وعدم بدء إصلاحات متفرقة قبل تثبيت خريطة التوجيه والهوية. لا تُجرِ أي نشر أو تبديل للأوزان لمجرد إغلاق الملاحظة؛ يجب إثبات كل إصلاح باختبار مناسب.

---

# 1. الخلاصة التنفيذية

هناك أساس معماري جيد في المشروع: Nova أصبحت منتجاً واحداً، والتطبيق المصغر يستخدم طبقة ربط للعمليات الخاصة بكل نموذج، والحاسوب المركزي منفصل عن استوديوهات الاستدلال والوسائط، كما أن مسار T-LDM أصبح يملك endpoint فعلياً داخل خادم Nova. لكن التنفيذ والاختبارات والوثائق لم تُوحّد كلها بعد مع قرار «Nova واحدة»، كما توجد مخاطر أمنية في الحاسوب والمتصفح تستحق الأولوية على تحسينات الشكل أو الأداء.

أهم النتائج:

1. **هوية Nova غير موحّدة عبر كل الطبقات.** الخادم يحوّل `nova2` القديم إلى `coder`، لكن Mini App وطبقة الحاسوب والاختبارات لا تزال تتعامل أحياناً مع Nova 2 كهوية منفصلة. هذا يخلق احتمالات اختلاف في معرّف الجلسة، خصوصاً في بث سطح المكتب.
2. **الحاسوب ليس آمناً بما يكفي ليُعامل كبيئة تنفيذ متعددة المستخدمين قبل إغلاق فجوات العزل.** قواعد منع الوصول للشبكات الخاصة Best-effort، والطرفية تستمر عند فشلها، ومتصفح Chromium يعمل مع `--no-sandbox`. المتصفح الرسومي لا يملك فحصاً مماثلاً لكل طلب فرعي/تحويل كما هو موجود في المتصفح headless.
3. **تحسين المتصفح #1195 دُمج، لكنه عطّل Site Isolation في Chromium الرسومي.** يجب مراجعة أثر ذلك أمنياً في بيئة تتصفح مواقع عامة غير موثوقة.
4. **T-LDM لنوفا ليس مجرد وثيقة أو فكرة الآن:** يوجد `generate_tldm` في خادم Nova، ويوجد خادم قارئ GGUF ورأس كاتب. لكن لا يوجد إثبات تشغيل حي للرأس على استوديو Nova الفعلي.
5. **تشغيل T-LDM رقم 45044580509 أنتج رأساً ورفع Artifact بنجاح، وفشل في النشر فقط بسبب وجهة ModelScope.** الرمز الذي مرّرته المهمة صالح لـ`modelscope.ai`، بينما عميل النشر اتصل بـ`modelscope.cn`. لا حاجة لإعادة التدريب لمعالجة هذا الخطأ.
6. **بوابة نشر T-LDM الحالية أضعف من اللازم إحصائياً.** المتوسطان تجاوزا 0.6، لكن نتيجة held-out-2 بقيت `inconclusive` حسب Wilson؛ خطوة النشر لا تتحقق من هذا الحكم.
7. **تطبيق GGUF الحالي هو Writer head فقط، وليس كامل تكافؤ منظومة Sham Pro T-LDM.** يجب تسميته بدقة وإكمال ما يلزم إن كان المطلوب نقله بكل قدراته.

---

# 2. Nova AI: الهوية والتوجيه

## 2.1 ما أصبح صحيحاً

- قائمة النماذج في `src/lib/coderModels.ts` أصبحت تعرض Nova واحدة تحت `coder`.
- `canonModelId()` يحوّل المعرّف القديم `nova2` إلى `coder` للمحافظة على العملاء/المحادثات القديمة.
- `src/lib/openCoderStudio.ts` يوجّه Nova الحالية إلى مجموعة استوديوهات Qwen3.6-35B-A3B الدولية عبر `nova2Urls()` بعد إزالة Nova القديمة Qwen3.5-4B من الاستدلال.
- يوجد فصل بين استوديو النموذج واستوديو الحاسوب؛ الحاسوب المركزي لا ينبغي أن يحمل أوزان النموذج أو مولّدات الوسائط.

المراجع:
- [coderModels.ts:23-27, 102-109](../../src/lib/coderModels.ts)
- [openCoderStudio.ts:85-110](../../src/lib/openCoderStudio.ts)
- [WORK_BOARD.md](../WORK_BOARD.md)

## 2.2 التناقض المتبقي: اسم واحد في الخادم وأسماء متعددة في Mini App

في المقابل:

- `src/lib/miniAppBinding.ts` لا يستعمل `canonModelId()`؛ دالة `canonicalModel()` تحوّل `sham_loop` فقط ولا تحوّل `nova2` إلى `coder`.
- `src/lib/computerModels.ts` ما زال يعرّف `coder` و`nova2` كخيارين مستقلين، ويصف لكل منهما مسار حاسوب.
- اختبار `miniAppBinding.test.ts` يفرض وجود أربع هويات منفصلة، ويختبر اختلاف جلسة الحاسوب بين `coder` و`nova2`. هذا لا يطابق حقيقة الخادم الذي يطبع `nova2` إلى `coder`.
- `coderApp.ts` يحتوي فروعاً لـ`selectedModel === "nova2"` بعد تنفيذ `canonModelId`؛ هذه الفروع لا يمكن بلوغها في المسار الطبيعي، وأصبحت أجزاء من كود Nova 2 القديم.
- `computerModels.ts` و`browserComputer.ts` ما زالا يحتويان تعليقات وقرارات تقول إن Nova 2 كيان منفصل وله حاسوبه الخاص، رغم أن المنتج صار Nova واحدة تستخدم مركز الحاسوب المركزي.

المراجع:
- [miniAppBinding.ts:25-44](../../src/lib/miniAppBinding.ts)
- [computerModels.ts:1-21](../../src/lib/computerModels.ts)
- [miniAppBinding.test.ts:14-75](../../src/lib/__tests__/miniAppBinding.test.ts)
- [coderApp.ts:140-157](../../src/lib/coderApp.ts)

**الإصلاح المطلوب:**

1. اجعل `canonModelId` المرجع الوحيد لتطبيع هوية النموذج، واستعمله في Mini App وكل endpoint وكل خدمة فرعية.
2. احتفظ بـ`nova2` كـlegacy alias للقراءة/الهجرة فقط، لا كمدخل نموذج ثانٍ أو session namespace مستقل.
3. لا تحذف سجلات المحادثات والمهام القديمة؛ انقل/اربط مفاتيحها إلى الهوية الحالية بطريقة متوافقة، مع اختبار أن كل مهمة قديمة ما زالت قابلة للاستكمال والإيقاف.
4. احذف الفروع الميتة تدريجياً بعد تغطية التوافق، لا بتغيير شامل غير مختبر.

## 2.3 احتمال اختلاف جلسة بث سطح المكتب

مسار `appOp` يطبّع النموذج قبل بناء جلسة الحاسوب، بينما `desktop_live` في `src/app/api/coder/app/route.ts` يأخذ `body.model` كما وصل من العميل وينشئ الجلسة من النص الخام:

- `appOp`: يبني الجلسة بعد `canonModelId`.
- `desktop_live`: يستخدم `model = String(body.model || "")` ثم `${chatId}:${model}`.

إذا وصل عميل قديم وما زال يرسل `nova2`، فقد يبدأ سطح المكتب في جلسة `coder` بينما بث الشاشة يبحث عن `nova2`، فيظهر سطح المكتب متوقفاً أو بلا بث رغم أن عملية البدء نجحت.

المرجع: [route.ts:31-49](../../src/app/api/coder/app/route.ts) مع [coderApp.ts:144-148](../../src/lib/coderApp.ts).

**الإصلاح المطلوب:** طبّع `model` في بداية مسار `desktop_live` أيضاً، وابنِ session key من المعرّف القانوني نفسه المستخدم في بدء سطح المكتب. أضف اختبار تكامل يرسل `nova2` قديماً إلى start/status/frame/click/stop ويتأكد من أن العمليات جميعها تصل إلى جلسة Nova الواحدة.

---

# 3. التطبيق المصغر Mini App

## 3.1 نقاط قوة يجب الحفاظ عليها

- توجد طبقة ربط `miniAppBinding` تحدد النموذج المختار وتربط المحادثات والذاكرة والحاسوب.
- `MODEL_SCOPED_OPS` يضيف النموذج إلى العمليات الخاصة به حتى لا يقرر الخادم النموذج من قيمة عشوائية في body.
- `appOp` يفرض صلاحيات المالك على الحاسوب والمتصفح والسطح الرسومي.
- مسار API لديه `maxDuration = 300`، ويستخدم بثاً حياً لسطح المكتب بدلاً من الاعتماد على لقطات JPEG متكررة.
- الاختبارات تغطي جوانب من فصل المهام والذاكرة والحاسوب بين Sham وSham Pro وNova.

هذه البنية مفيدة، ويجب إصلاح التناقضات داخلها لا استبدالها بطبقة ثانية موازية.

## 3.2 فجوة الاختبارات

اختبار `miniAppBinding.test.ts` يختبر جدول الربط منفرداً، لكنه لا يثبت أن نفس الهوية بقيت متطابقة بعد دخول `appOp` و`route.ts` و`desktopComputer`. لذلك قد تنجح اختبارات الربط مع أن الخادم يطبّع المعرّف إلى قيمة أخرى.

**الإصلاح المطلوب:**

- اختبار تكامل واحد يمر عبر API الحقيقي أو طبقة route كاملة لكل عملية: فتح محادثة، قائمة المهام، إنشاء مهمة، إيقافها، terminal، desktop start، desktop live، browser، file upload/download، memory، connectors، schedules، وT-LDM.
- تأكد من أن كل عملية تستخدم نفس `canonicalModelId` و`computerSessionOf` وnamespace الذاكرة والمهام.
- اختبر تبديل النموذج أثناء وجود جلسة أو مهمة قديمة؛ يجب ألا تنتقل بيانات النموذج الأول إلى الثاني.
- اختبر إطلاق Mini App من البوت الصحيح؛ لا تجعل اختيار أول بوت `NOVA_BOT` نشط بديلاً غير واضح عن معرف البوت المقصود إذا كان التطبيق يفتح من أكثر من بوت.

## 3.3 T-LDM غير مكشوف لنوفا في Mini App

الـbackend يملك مساراً لـT-LDM في Nova، لكن `coderApp.ts` يعرض `features.tldm` فقط عند اختيار `sham_v2`، كما أن حفظ إعداد `body.tldm` يرفض أي هدف غير `sham_v2`.

المراجع:
- [coderApp.ts:181-194](../../src/lib/coderApp.ts)
- [coderApp.ts:243-248](../../src/lib/coderApp.ts)

هذا ليس بالضرورة خطأً إذا كان قرار المنتج أن T-LDM لنوفا داخلي/تجريبي فقط، لكنه تناقض يجب حسمه: هل T-LDM لنوفا يعمل تلقائياً في الخلفية؟ أم يجب أن يظهر في Mini App للمالك؟ لا تترك الواجهة تعرض حالة غير ممثلة في الخادم.

---

# 4. الحاسوب المركزي Computer Hub

## 4.1 ما هو جيد

- الحاسوب المركزي خدمة منفصلة عن استوديوهات النماذج والوسائط؛ لا يحمل أوزان Nova ولا أوزان الصورة/الصوت/الفيديو.
- لكل مستخدم/نموذج مساحة عمل وجلسة مستقلة، مع تخصيص UID ومجلدات مبنية على session digest.
- توجد أدوات terminal/files/jobs/repo/search/patch/apps، وبنوك ملفات خاصة، ومتصفح headless مع BrowserContext مستقل.
- توجد قيود على المساحة والمهام، ويُفترض أن تكون البيئة CPU-only على استوديو الحاسوب المخصص.

يجب الحفاظ على هذا الفصل.

## 4.2 <badge>حرج</badge> قواعد الشبكة الخاصة وSSRF لا تعمل بطريقة fail-closed

في `computer_box.py`، دالة `install_egress_rules()` تصف نفسها بأنها Best-effort. إذا لم يكن التطبيق root أو لم يتوفر `iptables`، ترجع حالة صريحة تقول إن أوامر المستخدم يمكنها الوصول إلى الشبكة الخاصة للمضيف. لكن `run_command()` يستدعي الدالة ثم يكمل تنفيذ الأمر؛ لا يرفض التنفيذ عند غياب الحماية أو فشل إضافة القواعد.

المراجع:
- [computer_box.py:532-589](../../ai-system/modelscope-media/computer_box.py)
- [computer_box.py:782-814](../../ai-system/modelscope-media/computer_box.py)

وفي الحاسوب الرسومي، `desktop_computer.py` يتحقق من العنوان الأولي عبر `safe_url`، لكن التعليق في الكود يقر بأن المتصفح الرسومي يظل مسموحاً عندما تكون حماية الخروج للشبكة جزئية، ولا يعاد رفضه إلا عند ضبط `DESKTOP_BROWSER_STRICT=1`. هذا لا يعادل فحص كل redirect/subresource الذي يطبقه مسار المتصفح headless.

المراجع:
- [desktop_computer.py:924-929](../../ai-system/modelscope-media/desktop_computer.py)
- [browser_computer.py:100-134, 722-727](../../ai-system/modelscope-media/browser_computer.py)

**الإصلاح المطلوب:**

1. لا تسمح للطرفية بتنفيذ أوامر عندما تكون حماية الشبكات الخاصة/metadata غير متاحة أو جزئية؛ أعد حالة واضحة مثل `egress_not_secure` وارفض التنفيذ حتى تتوفر حماية فعلية.
2. اجعل الحاسوب الرسومي يطبق فحصاً لكل طلب وتحويل ومورد فرعي، أو امنعه من التصفح العام عند غياب firewall مضبوط. فحص URL مرة واحدة قبل فتح Chromium غير كافٍ.
3. أضف اختبارات SSRF تشمل IPv4 وIPv6، عناوين metadata، أسماء DNS، DNS rebinding، redirects، iframe، fetch/XHR، websocket، التحميلات، والروابط التي تبدأ عامة ثم تحوّل إلى عنوان داخلي.
4. لا تعتبر نجاح `safe_url` وحده إثباتاً لأن كل الاتصالات اللاحقة بقيت آمنة.

## 4.3 <badge>حرج</badge> Chromium يعمل دون Sandbox

- `browser_computer.py` يشغّل Playwright مع `--no-sandbox`، ويذكر أن تجربة bwrap مجرد فحص تشخيصي ولا يعتمد عليها كعزل فعلي.
- `desktop_computer.py` يشغّل متصفح سطح المكتب مع `--no-sandbox` أيضاً.
- خدمة المتصفح headless تستخدم عملية Chromium مشتركة لعدة BrowserContexts، بحد معلن يصل إلى ست جلسات.

المراجع:
- [browser_computer.py:1-14, 268-299, 433-438](../../ai-system/modelscope-media/browser_computer.py)
- [desktop_computer.py:290-299](../../ai-system/modelscope-media/desktop_computer.py)

فصل cookies وBrowserContext لا يعادل عزل نظام تشغيل بين جلسات غير موثوقة إذا كانت عملية Chromium نفسها بلا sandbox.

**الإصلاح المطلوب:** شغّل Chromium تحت مستخدم غير root مع Sandbox فعّال. إذا كان مزود الاستضافة يمنع user namespaces، لا تعوّض ذلك بتجاهل العزل؛ استخدم عملية/بيئة منفصلة لكل نطاق ثقة أو قلّل تعرض المتصفح المشترك. يجب إثبات ذلك باختبار فعلي، لا بمجرد نجاح launch.

## 4.4 تحسين المتصفح #1195: سرعة مقابل Site Isolation

PR #1195 دُمج في 2026-11-22 بالالتزام `f002114365b49d18189bcd3e2295c6f77a2bdf7e`. خفّف تشغيل Chromium على معالجين، لكنه أضاف تعطيل `site-per-process` و`IsolateOrigins` ضمن `--disable-features`.

هذا يخفض عبء المتصفح، لكنه يضعف عزل المواقع داخل عملية Chromium نفسها. ينبغي عدم اعتبار التحسين آمناً تلقائياً لمجرد نجاح CI.

المراجع:
- [PR #1195](https://github.com/jonsnow-org/Ttbik/pull/1195)
- [desktop_computer.py:290-299](../../ai-system/modelscope-media/desktop_computer.py)

**الإصلاح المطلوب:** قياس بديل يحافظ على Site Isolation قدر الإمكان. إن تعذر ذلك على 2 vCPU، فوثّق القرار الأمني وقلّل عدد المواقع/العمليات المفتوحة أو افصل عمليات المتصفح بحسب الجلسة، بدلاً من تعطيل الحماية بلا اختبار أمني.

## 4.5 السعة والذاكرة على 16 GB / 2 vCPU

الإعدادات الحالية تشمل:
- `COMPUTER_MAX_GLOBAL_JOBS=6`
- `COMPUTER_MEMORY_KILL_MB=8192` (لكل process group)
- حتى 5 desktop slots عند اكتشاف ذاكرة إجمالية تتجاوز 12 GB
- حد أدنى للذاكرة الحرة 2 GB للمهام و3 GB للسطح الرسومي.

المراجع:
- [computer_studio_app.py:37-46, 202-214](../../ai-system/modelscope-media/computer_studio_app.py)
- [computer_box.py:42-51, 597-642, 673-723](../../ai-system/modelscope-media/computer_box.py)

مراقبة الذاكرة الحالية تحسب RSS لكل process group على حدة. لا يظهر في هذا المسار حد إجمالي مضمون لكل الخدمات/الجلسات معاً أو حجز ذري للذاكرة قبل قبول عدة طلبات متزامنة. لذلك يمكن أن تقبل عدة مهام عندما تكون الذاكرة الحرة جيدة، ثم تتنافس لاحقاً على CPU/الذاكرة.

**الإصلاح المطلوب:**

1. إضافة حجز موارد مركزي atomically قبل تشغيل المهمة، مع سقف إجمالي للذاكرة وعدد مهام مناسب لنواتي CPU.
2. استخدام cgroups/حدود النظام الفعلية إن كانت متاحة، بدلاً من الاعتماد على مراقبة process group فقط.
3. اختبار تزامن واقعي: جلسات terminal + desktop + headless browser + تنزيلات/تثبيت، مع قياس RAM وCPU والمهل ومعدل فشل الإدخال.
4. لا ترفع `MAX_GLOBAL_JOBS` أو `DESKTOP_SLOTS` قبل ظهور نتيجة هذا الاختبار.

## 4.6 استمرارية التخزين والمهام الطويلة

- عند عدم استجابة mount `/mnt/workspace`، يختار `computer_studio_app.py` مجلداً محلياً بديلاً ويصفه بأنه non-persistent. هذا مفيد لاستمرار تشغيل الخدمة، لكنه يعني أن الملفات قد تضيع عند إعادة تشغيل الاستوديو.
- سجل المهام الحية `_JOBS` موجود في الذاكرة، بينما تُكتب بعض السجلات إلى ملفات. لا يظهر هنا استرجاع كامل لحالة job/process بعد restart.

المراجع:
- [computer_studio_app.py:13-40](../../ai-system/modelscope-media/computer_studio_app.py)
- [computer_box.py:58-63, 727-778](../../ai-system/modelscope-media/computer_box.py)

**الإصلاح المطلوب:**

- أظهر `storage_mode=persistent|ephemeral` في readiness/status، ولا تعرض الحاسوب بأنه دائم عندما يعمل على local fallback.
- عند غياب التخزين الدائم، امنع العمليات التي تتطلب حفظاً دائماً أو حذّر قبلها بوضوح.
- خزّن manifest للمهام الطويلة وstatus والـlogs وheartbeat على تخزين دائم، وأضف startup recovery يحدد: resumed / interrupted / lost. لا تكتفِ ببقاء ملف log دون سجل حالة المهمة.
- اربط job id بـ`user:model:task_id`، واجعل الإيقاف والاستكمال idempotent.

---

# 5. نظام T-LDM: الحالة الحقيقية وما يلزم استكماله

## 5.1 التصحيح المهم: endpoint موجود بالفعل

الملاحظة الأقدم في `docs/coder/NOVA_TLDM.md` و`docs/coder/REVIEW_NOTES.md` تقول إن خادم Nova لا يملك `generate_tldm`. هذه المعلومة أصبحت قديمة: يوجد الآن في `ai-system/modelscope-coder/app.py` تابع `generate_tldm` وواجهة Gradio تحمل API name نفسه، كما يوجد `nova_tldm_serve.py` لقراءة GGUF وتشغيل الرأس.

المراجع:
- [modelscope-coder/app.py:884-931](../../ai-system/modelscope-coder/app.py)
- [nova_tldm_serve.py](../../ai-system/modelscope-coder/nova_tldm_serve.py)
- [docs/coder/NOVA_TLDM.md](./NOVA_TLDM.md)
- [docs/coder/REVIEW_NOTES.md](./REVIEW_NOTES.md)

يجب تحديث الوثيقتين، لا تكرار تقرير «لا يوجد endpoint». لكن وجود endpoint لا يثبت أن الرأس منشور أو أنه يعمل على الاستوديو الحي.

## 5.2 نتيجة التشغيل رقم 45044580509 — دليل فعلي

من سجل GitHub Actions:

- Workflow: `T-LDM head on a GGUF reader (Nova route, CPU, no secrets)`
- Run: [45044580509](https://github.com/jonsnow-org/Ttbik/actions/runs/45044580509)
- Run number: 4
- Branch: `claude/nova-head-hf`
- عملية بناء llama-server، تنزيل GGUF/tokenizer، وتشغيل خادم embeddings نجحت.
- التدريب والتقييم نجحا، وتم إنشاء Artifact باسم `gguf-head` بحجم **18,076,503 bytes**.
- الأرقام:
  - `feature_width = 2048`
  - `texts = 387`
  - `read_secs = 270.5`
  - `train_mean = 1.0`
  - `heldout.mean = 0.889` على 12 مهمة
  - `heldout2.mean = 0.738` على 14 مهمة
  - `heldout2.verdict_mean = inconclusive` وفق Wilson.

**سبب الفشل الحقيقي:** خطوة النشر استخدمت `MODELSCOPE_AI_TOKEN` مع عميل `HubApi()` الذي اتصل تلقائياً بـ`https://modelscope.cn/api/v1/login`. سجل الخطأ يقول إن الرمز صالح على `https://www.modelscope.ai`، لا على `.cn`. لذلك فشل تسجيل الدخول قبل رفع الرأس. لم يفشل التدريب ولم يفشل إنشاء Artifact.

المصدر: سجل المهمة 45044580509، خطوة `Publish the head`، ورسالة `AuthenticationError [E3001]`.

**الإصلاح المطلوب دون إعادة التدريب:**

1. استخدم نقطة النهاية الدولية `https://www.modelscope.ai` في خطوة النشر، عبر إعداد `MODELSCOPE_ENDPOINT` المدعوم من العميل أو تهيئة HubApi صراحةً.
2. أبقِ `MODELSCOPE_AI_TOKEN` لهذه العملية لأنها تستهدف مساحة الحساب الدولية `Jonjithup/nova2-tldm-head`.
3. لا تستبدله برمز الحساب الصيني `MODELSCOPE_TOKEN` ولا تخلط الحسابين.
4. أضف خطوة preflight صغيرة تتحقق من هوية الحساب والوجهة قبل الرفع، ثم ارفع Artifact الموجود أو أضف workflow للنشر من Artifact؛ لا تعِد قراءة GGUF وتدريب الرأس من الصفر لهذا الخطأ.

## 5.3 بوابة النشر تقبل نتيجة غير حاسمة

في `.github/workflows/tldm-nova-gguf-head.yml`، شرط النشر الحالي يكتفي بأن يكون متوسط كل من `heldout` و`heldout2` أكبر أو يساوي 0.6. لكنه لا يشترط أن يكون حكم Wilson `pass`.

في Run #4، المتوسطان تجاوزا 0.6، ولذلك ظهرت `gate -> PASS`، لكن held-out-2 أعاد `verdict_mean = inconclusive`. أي أن شرط النشر الحالي لا يعكس مستوى اليقين الذي يحسبه التدريب نفسه.

المراجع:
- [train_gguf_head.py:54-61](../../ai-system/tldm/training/train_gguf_head.py)
- [workflow: خطوة Publish](https://github.com/jonsnow-org/Ttbik/blob/claude/nova-head-hf/.github/workflows/tldm-nova-gguf-head.yml)

**الإصلاح المطلوب:** اجعل قرار النشر يتطلب `pass` على مجموعتي held-out، أو زد عدد المهام غير المرئية حتى يصبح الحكم الإحصائي حاسماً. لا تعتبر متوسط 14 مهمة دليلاً نهائياً على الجاهزية. أضف مجموعة benchmark من مهام GitHub/terminal حقيقية غير متداخلة مع التدريب.

## 5.4 إعدادات workflow الافتراضية لا تطابق Nova الحالية

ملف workflow ما زال افتراضياً يطلب:
- GGUF: `Qwen3.5-4B`
- tokenizer: `Qwen/Qwen3.5-4B`
- config: `nova1.yaml`

بينما Nova الحالية في الإنتاج هي Qwen3.6-35B-A3B، وخادم T-LDM يحمّل افتراضياً `nova2_heads.pt` من `nova2-tldm-head` ويستخدم tokenizer Qwen3.6-35B-A3B.

قد تكون Run #4 استخدمت inputs بديلة، لكن defaults الحالية تسمح بتشغيل خاطئ ينتج رأساً على جسم/Tokenizer غير الجسم الذي سيخدمه الاستوديو.

المراجع:
- [workflow inputs](https://github.com/jonsnow-org/Ttbik/blob/claude/nova-head-hf/.github/workflows/tldm-nova-gguf-head.yml)
- [nova_tldm_serve.py:28-34, 102-129](../../ai-system/modelscope-coder/nova_tldm_serve.py)
- [configs/nova1.yaml](../../ai-system/tldm/configs/nova1.yaml)
- [configs/nova2.yaml](../../ai-system/tldm/configs/nova2.yaml)

**الإصلاح المطلوب:** غيّر defaults لتطابق Nova الحية (GGUF URL/hash، tokenizer، config، اسم الرأس/repo)، وامنع النشر إذا اختلفت هوية GGUF أو tokenizer أو feature width عن metadata المحفوظة في checkpoint.

## 5.5 هذا Writer-only T-LDM وليس كامل مسار Sham Pro

ملف `train_gguf_head.py` يصرّح صراحةً أنه `Writer head only`، ويصدر payload يحتوي `heads: {writer: state}` فقط. خادم Nova يحمّل الكاتب فقط ويستدعيه لإنتاج أمر shell أو أداة مقروءة.

هذا نقل مفيد لجزء الكاتب من التقنية، لكنه لا يثبت نقل دورة self-evolution/loop أو بقية مكونات التدريب التي تستخدمها منظومة Sham Pro. لا تخلط بين «Writer head اجتاز benchmark» و«نوفا أصبحت تملك كامل T-LDM والقدرات متعددة الخطوات نفسها».

المراجع:
- [train_gguf_head.py:1-6, 43-61, 87-90](../../ai-system/tldm/training/train_gguf_head.py)
- [nova_tldm_serve.py:102-143](../../ai-system/modelscope-coder/nova_tldm_serve.py)

**الإصلاح المطلوب:** إما تسمية هذا المسار بوضوح `T-LDM Writer on GGUF` مع حدود وظيفته، أو إضافة تدريب/خدمة/اختبار loop متعدد الخطوات إذا كان المطلوب تكافؤاً كاملاً مع Sham Pro. اختبر مهاماً متسلسلة تتطلب أكثر من استدعاء أداة، لا مجرد أمر واحد.

## 5.6 حمل الاستدلال والذاكرة غير مثبتين على استوديو Nova

`nova_tldm_serve.py` يبدأ llama-server ثانياً على نفس GGUF مع `--embeddings --pooling none`، ثم يحمل PyTorch head وtokenizer. مشاركة ملف الأوزان عبر mmap لا تعني أن buffers والذاكرة العاملة الإضافية مجانية.

كما أن Torch/Numpy/Tokenizers تُثبت عند أول طلب T-LDM داخل الخدمة، بمهلة تثبيت قد تصل إلى 1500 ثانية. هذا يضع عبء تجهيز كبيراً على أول طلب ويجعل latency الأول غير مناسب.

المراجع:
- [nova_tldm_serve.py:73-99, 146-163](../../ai-system/modelscope-coder/nova_tldm_serve.py)

**الإصلاح المطلوب:**

1. لا تفعّل `NOVA_TLDM=1` للمستخدمين قبل اختبار الرأس على استوديو Nova الفعلي مع خادم المحادثة وخادم embeddings معاً.
2. قِس peak RSS، زمن الإقلاع، زمن أول طلب، زمن الأداة، ومعدل OOM مع الحاسوب/المهام المتزامنة.
3. ثبت الاعتماديات بإصدارات محددة أثناء بناء/تهيئة الاستوديو، لا أثناء أول طلب مستخدم.
4. إذا لم تتوفر ذاكرة كافية على CPU، أبقِ T-LDM معطلاً برسالة صريحة؛ لا تحاول إخفاء العجز ولا تحوّل الطلب إلى نموذج آخر.

## 5.7 pending tool request لا يتحمل التوازي وإعادة تشغيل الاستوديو

`nova_tldm_serve.py` يخزن طلب الأداة المعلّق في `_PENDING` بذاكرة العملية، ومفتاحه session واحد. كما أن الاستكمال يحذف العنصر من القاموس قبل متابعة الطلب التالي. هذا لا يوفر سجلاً دائماً لطلبات الأدوات، ولا أكثر من pending واحد لكل session.

المراجع:
- [nova_tldm_serve.py:36-38, 192-250](../../ai-system/modelscope-coder/nova_tldm_serve.py)
- [novaTldm.ts:43-54, 112-151](../../src/lib/novaTldm.ts)
- [coderSections.ts:2854-2873](../../src/lib/coderSections.ts)

إذا أطلقت مهمتان أو agent/tool turns على نفس chat/model في الوقت نفسه، يمكن أن يستبدل pending لأحدهما الآخر. وإذا أعيد تشغيل الاستوديو بين طلب الأداة والرد عليها، يفقد الخادم بيانات الاستكمال الموجودة في الذاكرة.

**الإصلاح المطلوب:**

- اجعل مفتاح الاستكمال `user:model:task_id:request_id` بدلاً من session واحدة.
- خزّن pending/history في مخزن دائم مع TTL، وحالة consumed تمنع تنفيذ الأداة مرتين.
- أضف locking على عمليات put/consume، وحداً أقصى للطلبات المنتهية/المهملة.
- اختبر مهمتين متوازيتين في محادثة واحدة، وإعادة تشغيل الاستوديو بين tool_request وresume، وإعادة وصول resume مرتين.

## 5.8 حماية أوامر T-LDM

الرأس يعيد إما نصاً أو `$ command` أو `$ @tool NAME JSON`. القائمة `READ_TOOLS` محددة، والطلب يعود إلى التطبيق كـtool call؛ حافظ على هذا التصميم. لا تسمح لخادم الرأس بتشغيل أدوات GitHub أو shell مباشرة داخل process الرأس.

المراجع:
- [nova_tldm_serve.py:33-34, 192-220](../../ai-system/modelscope-coder/nova_tldm_serve.py)
- [novaTldm.ts:135-153](../../src/lib/novaTldm.ts)

المطلوب أن تمر كل أداة عبر schema validation، وmodel-scoped policy، وقواعد تأكيد/موافقة الحاسوب نفسها التي تستخدمها Nova العادية. أضف اختبارات تؤكد أن طلب أداة غير موجودة أو معاملات غير صالحة أو pending من session أخرى لا يمكن أن ينفّذ.

## 5.9 توحيد سياسة T-LDM مع هوية Nova الواحدة

`tldmPolicy.ts` ما زال يعرف `coder` باسم `NOVA1` و`nova2` باسم `NOVA2`، و`coderModels.ts` يطبع `nova2` القديم إلى `coder`. هذا يترك مفاتيح وبيئة سياسة مكررة لنموذج أصبح واحداً.

المراجع:
- [tldmPolicy.ts:14-21, 102-124](../../src/lib/tldmPolicy.ts)
- [coderModels.ts:102-109, 218-230](../../src/lib/coderModels.ts)

**الإصلاح المطلوب:** اجعل Nova الحالية مفتاح سياسة واحداً واضحاً (`coder` أو prefix موحد `NOVA_TLDM_*`) مع ترحيل قيم `NOVA1_*`/ `NOVA2_*` القديمة دون فقد deny-list أو صلاحيات المستخدمين. أبقِ `sham_v2` مستقلاً كلياً عن Nova.

---

# 6. خطة التنفيذ ذات الأولوية

## P0 — الأمن والعزل قبل توسيع الاستخدام

1. **Fail-closed للشبكة:** ارفض الطرفية والمتصفح الرسومي إذا كانت حماية private/metadata egress غير مكتملة. اختبر ذلك عند غياب iptables وip6tables.
2. **Chromium sandbox:** شغّل المتصفح تحت UID غير root وبـsandbox فعال، أو اعتمد عزل عملية/بيئة منفصلة مثبتاً. راجع آثار تعطيل Site Isolation في #1195.
3. **توحيد فحص المتصفح:** اجعل المتصفح الرسومي يراجع redirects/subresources مثل headless، ولا تسمح بوصوله إلى الشبكات الخاصة لمجرد أن عنوان البداية عام.

## P1 — تصحيح الهوية وإكمال T-LDM

4. **هوية Nova:** وحّد `coder` عبر Mini App وComputer وbrowser/desktop_live والذاكرة والمهام والموصلات، مع alias قديم للهجرة فقط.
5. **تصحيح نشر رأس T-LDM:** استخدم endpoint الدولي الصحيح مع `MODELSCOPE_AI_TOKEN`، وارفع Artifact الموجود من Run #4 دون إعادة التدريب.
6. **بوابة T-LDM:** لا تنشر إذا ظلت نتيجة Wilson غير حاسمة؛ كبّر مجموعات held-out وأضف full-task benchmark.
7. **مطابقة checkpoint:** اربط الرأس ببصمة GGUF وtokenizer ونسخة llama.cpp وconfig وfeature width، وارفض أي عدم تطابق.
8. **اختبار خدمة حقيقي:** بعد النشر، اختبر `generate_tldm` من bot ثم Mini App ثم الأدوات مع موافقات الحاسوب، على استوديو Nova الفعلي، وقِس الذاكرة والسرعة.
9. **استكمال pending:** اجعل طلبات الأدوات متعددة المهام ودائمة وقابلة للاستكمال بعد restart.

## P2 — الاستقرار والتوثيق والأداء

10. إضافة global memory/CPU admission budget حقيقي للحاسوب بدلاً من حدود منفصلة قد تتجاوز مجموع RAM.
11. تمييز التخزين الدائم عن local fallback في status وواجهة المستخدم، وإضافة recovery للمهام.
12. تحديث `WORK_BOARD.md` و`SCAN_2026-11-22.md` و`docs/coder/NOVA_TLDM.md` و`docs/coder/REVIEW_NOTES.md` لتعكس قرار Nova الواحدة ووجود endpoint ونتيجة Run #4 وفشل النشر بسبب endpoint.
13. تثبيت نسخة llama.cpp المستخدمة في التدريب والخدمة، وتسجيل hashes للأوزان والـtokenizer والـcheckpoint لضمان قابلية إعادة الإنتاج.
14. أعد تقييم سرعة Chromium بعد إغلاق الثغرات الأمنية؛ لا تجعل تقليل ثوانٍ قليلة سبباً لتعطيل حدود العزل.

---

# 7. اختبارات القبول المطلوبة قبل اعتبار العمل منتهياً

- [ ] Nova واحدة فقط ظاهرة، وأي `nova2` قديم يصل إلى نفس المسار والذاكرة والمهام وجلسة الحاسوب دون ازدواج.
- [ ] اختبار start/frame/click/stop للسطح الرسومي على الهوية القديمة والجديدة ينجح من دون اختلاف session id.
- [ ] لا يصل terminal/browser إلى private IP أو metadata عند غياب قواعد firewall أو عند redirect أو DNS rebinding.
- [ ] Chromium يعمل مع sandbox فعلي، وتُراجع تأثيرات Site Isolation بعد PR #1195.
- [ ] ضغط 2 vCPU / 16 GB يثبت أن عدة جلسات لا تسبب OOM أو تجميد الإدخال، مع سقف موارد مركزي.
- [ ] استئناف مهمة computer بعد restart يعطي حالة موثوقة: resumed أو interrupted أو failed، لا حالة مجهولة.
- [ ] نشر رأس T-LDM يتم على حساب ModelScope الدولي الصحيح، مع فحص هوية الحساب والـrepository.
- [ ] checkpoint يطابق GGUF وtokenizer الحاليين، وhead يبدأ على Studio Nova دون OOM.
- [ ] T-LDM ينجح في محادثة فعلية: طلب → tool_request → موافقة التطبيق → تنفيذ الأداة → resume → إجابة نهائية.
- [ ] اختبار مهمتين متوازيتين في نفس chat يثبت عدم اختلاط pending requests.
- [ ] نتائج held-out وWilson وfull-task benchmark مقبولة قبل إعلان T-LDM جاهزاً.

---

# 8. ما لم يتم إثباته في هذه المراجعة

- لم يتم إجراء اتصال حي إلى Studio Nova أو Computer Hub في هذه المراجعة؛ نتائج ModelScope المذكورة مأخوذة من سجل GitHub Actions فقط.
- نجاح CI لـPR #1195 لا يثبت أن المتصفح الرسومي أو الحاسوب المركزي اجتازا اختباراً أمنياً متعدد المستخدمين.
- Run #45044580509 أثبت التدريب والـArtifact على GitHub runner، لكنه **لم يثبت** أن الرأس يعمل على Studio Nova الفعلي أو أن الذاكرة تكفي لخادمي المحادثة والـembeddings معاً.
- فشل النشر في Run #45044580509 كان في مصادقة endpoint وليس في التدريب؛ Artifact موجود، لكن لم يتم التحقق من نشره في ModelScope.
- لم يتم تنفيذ إصلاحات الكود هنا؛ هذا الملف ملاحظة مراجعة فقط.

**القرار المطلوب من كلود:** ابدأ بـP0 الخاص بأمن الحاسوب والمتصفح، ثم وحّد هوية Nova، ثم أصلح نشر T-LDM باستخدام Artifact الحالي وتحقق من توافق الرأس على الاستوديو الحي. لا تعِد التدريب قبل معالجة سبب المصادقة، ولا تعلن T-LDM جاهزاً بناءً على متوسط benchmark وحده.
