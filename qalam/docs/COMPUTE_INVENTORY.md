# جرد حوسبة ModelScope لتدريب قلم، مقسَّمًا بحسب النموذج الذي يستعمل كل استوديو (2026-11-28، قراءة فقط)

**المصادر:** قائمة الحسابين (cn: التشغيل `46149540786`، ai: `46149543510`) + مسح المستودع كله (كود، سير عمل، `.env.example`، `cloudflare/studio-guard-worker.js` الذي يوقظ الاستوديوهات المسجّلة كل 10 دقائق، `keep-warm-chat-studios.yml`، `STUDIOS.md`، `WORK_BOARD.md`). لم يُغيَّر شيء ولم يُطبع سر. **لا تدريب قبل اعتماد قلم النهائي.**
**قاعدة الاختيار:** استوديو لا يذكره أي كود أو سير عمل أو حارس هو المرشَّح. «نائم» وحده لا يكفي (قد يكون مستعملًا بين الطلبات).

## 0) قرارات المالك (2026-11-28)
- **كل استوديو فارغ ومتروك يُخصَّص لقلم** (فئة §2: 9 في cn، والعاشر `juggernaut-ragnarok-image-test` بقرار منفصل).
- **لا GPU.** كل التدريب على معالجين و8 GB للاستوديو.
- **cn منصة التدريب. ai منصة الخدمة:** يُفترض أن شام وشام برو ونوفا والحاسوب على ai.

**⚠ تناقض بين هذا وما قرأته من السجلات اليوم (لم أتصرف بناءً على أيٍّ منهما):**
خدمة النماذج الثلاثة **حاليًا على cn لا على ai**: `sham-v1-server` و`sham-v2-server` (+overflow وvideo) و`coder-inference-server` وملحقاتها (-4/-5) و`nova-media-server` و`epicrealism-image-test` و`nova-inference-server`، كلها Running أو Sleeping في cn (31 استوديو). في ai أربعة فقط (نوفا 2، قارئ T-LDM، حاسوب نوفا المركزي، مشغّل GitHub)، وسقفه 5. ونقل الخدمة كلها إلى ai لا يتسع (أكثر من 14 استوديو خدمة مقابل خانة واحدة). لذلك لا أنقل ولا أوقف ولا أحذف شيئًا قبل أن تقول ما تقصد: (أ) وصف للوضع المستهدف لا الحالي، (ب) أم أن علينا إخلاء cn من الخدمة، وهو قرار كبير يمسّ الإنتاج ونشر Vercel وحارس الاستوديوهات.

## 1) ما يستعمله كل نموذج: ابتعد عنه
| النموذج | الاستوديوهات | الدليل |
|---|---|---|
| **نوفا** (cn) | `coder-inference-server` (4B، يخدم الآن) · `-2` (نسخة، وتعمل الآن مدرّب T-LDM لشام برو sham2-cn2) · `-3` (نسخة، ومدرّب الحركة) · `-4` · `-5` (نسخ؛ -5 للرؤية) · `nova-media-server` · `epicrealism-image-test` (**مولّد صور نوفا**) · `nova-inference-server` (**حاسوب مركزي محجوز**، لا يُدرج في أي حارس) | `OPEN_CODER_STUDIO_URLS`، `NOVA_IMAGE_STUDIO_URL`، `NOVA_MEDIA_STUDIO_URL`، `COMPUTER_STUDIO_URL` |
| **نوفا 2 / حاسوبها** (ai) | `coder-inference-server-16` · `nova-tldm-reader` (قارئ T-LDM) · `sham-trainer-2` (**حاسوب نوفا المركزي رغم اسمه**) | `NOVA_TLDM_READER_STUDIOS`، الحارس |
| **شام برو = شام v2** (cn) | `sham-v2-server` · `sham-v2-overflow-server` · `sham-v2-video-server` (ما زال في `SHAM_V2_VIDEO_URL`) · `sham2-tldm` و`sham-tldm-writer` (مدرّبا T-LDM والرأس) · `sham-donor-qwen35-9b-test` و`sham-donor-gemma4-e4b-test` و`sham-donor-minicpmo45-test` (مانحون، **يُوقَظون كل 10 دقائق**) · `sham-donor-gemma4-e4b-media` (مذكور في أداة حالة المدرّبين) | `SHAM_V2_URL`، `SHAM_V2_VIDEO_URL`، الحارس |
| **شام v1** (cn) | `sham-v1-server` · `sham-trainer-1` (مدرّب، Running) · `sham-trainer-tools` (مدرّب ms3) | `SHAM_MODELSCOPE_URL`، الحارس، `sham_trainer_status.py` |
| **LFM 2.5** (cn) | `lfm25-inference-server` (يُوقَظ بالحارس) | الحارس |
| **بنية مشتركة** (ai) | `sham-runner-1` = **مشغّل GitHub ذاتي الاستضافة (`studio`)** يشغّل سير عمل المستودع | `ci.yml`، `deploy-studio-runner.yml` |

## 2) لا يذكرها أي كود أو سير عمل أو حارس: المرشَّحة لقلم (9 في cn)
| الاستوديو | الحالة | ما وجدته |
|---|---|---|
| `umranz-sd15-image-test` | Stopped | **صفر إشارات** |
| `gemma4-realistic-vision-v6-test` | Stopped | **صفر إشارات** |
| `cyberrealistic-final-test` | Stopped | إشارة واحدة في اختبار (نص مستودع نموذجه) |
| `realistic-vision-v6-test` | Sleeping | تعليق في الكود يقول إنه «كان» استوديو أُزيل؛ وصف في README تجربة |
| `sham-donor-qwen35-9b-media` | Sleeping | **صفر إشارات** (مانحه `-test` مستعمل، هذا لا) |
| `sham-donor-minicpmo45-media` | Sleeping | **صفر إشارات** |
| `lfm25-media-server` | Sleeping | **صفر إشارات** |
| `sham-trainer-nb1` | Sleeping | **صفر إشارات** |
| `nova-computer-hub` | Sleeping | **صفر إشارات** (غير `nova-inference-server`: لا تخلط) |

**عاشر بشرط:** `juggernaut-ragnarok-image-test` (له سير نشر خاص، ووثيقة تقول «تجربة صور منفصلة»؛ لا نموذج يوجّه إليه): قرارك.
**الحساب الدولي (ai): لا فارغ.** كل استوديوهاته الأربعة مستعملة (§1).

## 3) ما يعنيه هذا لقلم
- **9 استوديوهات cn بمعالجين و8 GB** (لا GPU)، ولا مزامنة تدرّج بينها: تجارب مستقلة لا تدريب موزَّع. `base` (142M) على معالجين أبطأ من الجهاز الذي قسنا عليه (274 رمز/ث) يحتاج مصدر GPU.
- **قبل أي نشر:** أتحقق (قراءة) من أن الاستوديو بلا تطبيق حيّ، وأضيفه إلى حارس خاص بقلم لا إلى قوائم نوفا/شام، وأبني استوديو قلم بنظام نشر منفصل كي لا يكسر `keep-warm` ولا الحارس.
- **ما لم أتحقق منه:** محتويات الاستوديوهات الداخلية (جرد التطبيق العميق `46149854518` ما زال يعمل ببطء)، وهل الاستوديو النائم يستيقظ آليًا. تأكيدك لـ§2 يكفي لاعتمادها.
