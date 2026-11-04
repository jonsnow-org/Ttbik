# HANDOFF — 2026-11-04 (Europe/Istanbul, 02:45)

No secrets here: variable names only. Production branch: `claude/free-services-marketplace-h6rwk2`. `main` follows it through sync, and Oracle follows `main`.

## What changed on Nov 4 (PRs #648–#660)
- **New independent model LFM2.5-8B-A1B (`lfm25`)**: owner-only and hidden for now.
  - It has its own inference Studio (`lfm25-inference-server`, `LFM_STUDIO_URLS`) and its own media Studio (`lfm25-media-server`, `LFM_MEDIA_STUDIO_URL`).
  - It has its own computer session `${userId}:lfm25`.
  - No fallback to Nova or any other model. An empty pool fails with "off".
  - Measured: the repo-explain task took 198 s (Nova took 795 s); image 52 s; speech 21 s.
- **Strict separation**:
  - The AsyncLocalStorage `withEngineModel` in openCoderStudio.ts routes every completion to the selected model's pool.
  - `modelMedia.ts` routes each model's media to its own Studio and refuses `nova-inference-server`.
  - MODEL_OVERRIDES serves only the overridden model.
- **Computer hub** (`nova-inference-server`, 16 GB, computer only):
  - New tools: computer_patch (unified diff), computer_test (runner detection, run as a job), computer_tools, and **computer_batch** (up to 8 steps in one round trip).
  - repo fetch answers within 12 s; tips are guarded; the apt cache lives on `/mnt/workspace`; the browser worker env was fixed.
  - Bench (`computer-hub-bench.yml`), before → after:
    - repo: FAIL → OK;
    - patch and tools: unsupported → OK;
    - each round trip costs about 1.8 s of gateway time, so use batch.
- **Media**: a refused submit (429/502–504) is retried after 2, 5 and 10 s. Nova audio was failing on a single 429.
- **Long tasks**: orphan resume now covers tasks up to 6 h (was 30 min), capped at CODER_MAX_RESUMES. Live disconnect E2E: `nova-task-live.yml` with `drop_continue=1`. No message may pass 4096 characters.
- **Owner feedback**: 12-hour clock (agent, schedules, app); no English-prompt talk; a false "sent" claim is blocked; simple media goes straight to make_media.
- **Second free host for Sham v2**: decision is **Oracle Always Free A1**, on a new tenancy. See `hosting/sham-v2/README.md`.
  - Hugging Face Docker Spaces now require PRO, so they fail the "free forever" condition.
  - The site's tenancy has no A1 quota left.
  - **Owner action needed**: sign up and create the VM (steps in the README).

## Still open
1. Clone speed: the full clone takes 106 s. Find where the time goes from the repo-fetch markers in the bench.
2. Media speed: Nova image is about 144 s (512×768, 24 steps); LFM video 391 s. Reduce steps or size only with a quality comparison.
3. Sham v2: its Studios are ready again. Arabic answers sometimes contain a foreign word (model quality). Never touch v1.
4. #505 stays a draft; **#184 is never merged**; #647 (inventory probe) is a draft.

---

# HANDOFF — 2026-10-28 (Europe/Istanbul، 16:30)

للمهندس الذي يقرأ المشروع. المصدر: `/workspace/work/TODO.md` + جلسة اليوم. لا أسرار هنا: أسماء المتغيرات فقط.
قائمة المتابعة الحية: PR #505 (draft، **لا يُدمج**). نفس هذه المذكرة في body الـ#505.

## القواعد الثابتة (من المالك)
- **CPU only** لكل التوليد والاستدلال؛ لا GPU.
- **لا خدمات وسائط خارجية** (HeyGen، HyperFrames، Cloudflare AI، edge-tts، gTTS، HF Spaces). HF للتنزيل الأولي للأوزان فقط، لا للتوليد. فيديو حقيقي (AnimateDiff) وليس صوراً متتابعة.
- **Nova و Sham v2 مستقلان في الاستدلال والوسائط**: لكل منهما Studios خاصة (انظر `docs/STUDIOS.md`). `nova-inference-server` مخصص الآن للحاسوب المشترك فقط، وليس Studio استدلال أو وسائط لأي نموذج. عزل بيانات الحاسوب يبقى حسب المستخدم+النموذج.
- **#184 لا يُدمج أبداً.**
- الإصلاحات المؤكدة بالتشغيل فقط؛ الدمج فور CI أخضر؛ الأوزان لا تُستبدل إلا بإثبات أنها أفضل؛ المالك معفى من الحدود.
- حدود Vercel اليومية: الإصلاحات التي توقف الإنتاج تُشحن فوراً.

## البنية باختصار
- فرع الإنتاج `claude/free-services-marketplace-h6rwk2` (Vercel). `sync-main.yml` يقدّم `main` بعد CI أخضر. **Oracle يتبع `main`** وخلف Cloudflare هو الأساسي؛ Vercel احتياطي. `oracle-freshness.yml` (كل ساعتين) يقارن نصوص البناء: المطلوب «SAME BUILD».
- نماذج: **Nova** (Qwen3.5-4B على llama-server، بوت عام + Mini App)، **Sham** (القديم، من الصفر، لا يزال يتدرب)، **Sham v2** (Sham + أوزان جاهزة + مولّد وسائط).

## ما أُنجز (PRs #486 … #529+)
- #486–#503: قوائم محادثات لكل نموذج، إعدادات الذاكرة، CI معزول، Nova e2e، فصل Sham / Sham v2 / Nova، إعدادات لكل نموذج، مفاتيح المالك.
- #504 (Batch 3): فحص محتوى حقيقي للوسائط (`media_quality`: صورة غير سوداء، صوت غير صامت، فيديو إطارات>1 وحركة)، أولوية طابور Pro/المالك، SSRF fix، حصص Nova اليومية للجميع (مجاني 3 صور/3 فيديو، Plus 20/8، Pro 60/20) مع رسالة ترقية عربية، دمج #381/#384 وأجزاء #376/#374.
- #506/#511/#515/#516: فيديو Sham v2 الحقيقي (قرص الاستوديو، ModelScope أولاً، lean fp16، استوديو فيديو مستقل `sham-v2-video-server`).
- #509/#510: اسم أداة make_media، freshness بمقارنة النصوص.
- #519–#526: تبويب المحادثات، إيقاف المهام العالقة، مسار Nova السريع للصور، **رسالة واحدة لكل طلب في Telegram** (`singleMessage.ts`: «فهمت طلبك» + التقدم ثم تُحرَّر إلى الإجابة الحية)، طابور ظاهر بدل «مشغول»، عزل المستخدمين وإخفاء الطرفية عن المجاني، توجيه الازدحام لكل نموذج، **وضع الضغط للمالك** (`pressureMode.ts`)، استوديو overflow لـ Sham v2، #526: رابط استوديو Nova افتراضي مدمج (انظر «متابعة»).
- #527: لوحة المالك: «متاح للجميع / مخفي» لكل نموذج مرتبط بفحص الوصول الحقيقي (`modelUsableBy`)، عرض «ماذا يستخدم كل نموذج للوسائط».
- #528: فحص حي لبطاقة التقدم (من المسار الآخر).
- **#529 (2410db09)**: نظام أوضاع موحد `src/lib/modes.ts` (+`modeForce.ts`): fast/balanced/precise + Auto + **سياسة تفكير** adaptive/always/never حسب المرحلة (plan/act) — Nova يفكر في plan للكود والمهام الطويلة، لا في التحية/الوسائط/خطوات الأدوات. تحية خفيفة، أوامر قصيرة ("عدّل") تحتفظ بكل الأدوات. **Sham v2 بلا تفكير/أوضاع مُدرَّبة** (SFT على `<think></think>` فارغ) فهي ضبط أخذ عينات وطول فقط. صور Sham v2 بجانب 640 وخطوة واحدة (SDXS نموذج خطوة واحدة؛ 2-3 خطوات ضجيج). سقف رموز Sham v2 مرفوع (يحتاج redeploy). قياسات في `docs/MODES.md`. ESLint 9 flat (`npm run lint`: 0 أخطاء، 156 تحذيراً مقصودة). `docs/STUDIOS.md` + اختبار العزل.

## ما بقي / يحتاج متابعة
1. **حكم مولّد الرموز الداخلي لـ Sham v2** («شام الداخلي»): الكود يقول إنه «still training» والبوابة ترفض غالباً؛ الفيديو منه غير مدعوم عمداً (`NO_VIDEO`). تشغيل فعلي للقياس: workflow قراءة فقط `sham-v2-internal-check.yml` (PR #530، بسر `MODELSCOPE_TOKEN`). **النتيجة لم تُسجَّل هنا بعد** — راجع artifact `sham-v2-internal` وحدّث هذه الفقرة.
2. **تحقق حي على Telegram** (لم يُنفَّذ من قبلنا بحساب المالك): الرسالة الواحدة المحرَّرة، توجيه الازدحام، وضع الضغط، «قم بتوليد صورة أسد» (Nova فشل عند المالك قبل #526؛ أعد الاختبار).
3. **Oracle**: متغيرات بيئته غير قابلة للقراءة من هنا؛ يُرجَّح أنه بلا `NOVA_MEDIA_STUDIO_URL` (Vercel يحمله). #526 يضع رابطاً افتراضياً، لكن يجب تأكيد/ضبط المتغير على Oracle. كذلك `SUPER_ADMIN_TELEGRAM_ID` و`TELEGRAM_ADMIN_CHAT_ID` موجودان في Vercel (sensitive) ولا يمكن مطابقة قيمتهما مع معرّف المالك الحقيقي — تحقق يدوي (سبب رسالة «للمالكين فقط» السابقة كان هلوسة نموذج + Oracle قديماً، لا مساراً في الكود).
4. **Oracle freshness بعد #529**: تأكد من SAME BUILD على آخر `main` (آخر تشغيل بعد الدمج مباشرة كان «DIFFERENT» لأن Oracle لم يسحب بعد).
5. **Lint في CI**: PR #532 (job موازٍ، 0 أخطاء).
6. **`src/lib/clientPrep.ts`** موجود **دون ربط** (لا مسار رفع في التطبيق). قرار المالك: لا خيار مشاركة معالج للمستخدم؛ فقط أعمال خفيفة (تصغير صور، تحضير ملفات) وتُدار من لوحة المالك. لم يُوصَل.
7. **بطاقة التقدم**: سطر «الفهم» المولَّد بالنموذج + تدقيق agents/tools من المسار الآخر (#528 فحص حي فقط) — حالتهما لم أتحقق منها؛ راجع ذلك المسار.
8. **Redeploy لاستوديوهات Sham v2** كي يعمل سقف الرموز الجديد (`ai-system/modelscope-sham/app.py`)، وتأكد من `status`.
9. **BotFather**: `/setname` → «Nova AI» يدوياً من المالك (لا صلاحية لنا).
10. **سطر Oracle health-report في `deploy/oracle/agent/common.sh`**: الملف محمي ويحتاج وسم `owner-approved` على الـPR (بند M في TODO.md)؛ راجع حالة تنفيذه.
11. **#237** (base main، يتعارض، edge-tts ممنوع): تبقى مفتوحة للمراجعة. **#184**: لا يُمس. **#505**: القائمة الحية، draft، لا تُدمج.
12. صورة Sham v2: `prof.image` في `modes.ts` توثيق فقط؛ الفعلي `SHAM_IMAGE_SIDE` في `sham_media_ready.py`.

## ملاحظات Studios
استوديوهات Nova وSham ومرشحو الأوزان تبقى مستقلة للاستدلال والوسائط، بينما `nova-inference-server` مخصص للحاسوب 16GB فقط. Sham v2 overflow في `sham-v2-overflow-server`. التفاصيل والاختبارات: `docs/STUDIOS.md`.

## 2026-11-04 05:30 (Istanbul): MiniCPM-o 4.5 slow reply (~4 min) and Chinese inside Arabic

Owner test, 5:10 AM: «من انت يا» on MiniCPM-o 4.5 answered at 5:13 AM, with «的人工智能助手» mixed into the Arabic text.

**Root causes, from the code (no fresh Studio measurement yet):**
- Every message, including a greeting, went through the full tool path. The Telegram ingress (`donorJobStart`) always sends `use_tools: true`. In `infer()` the Studio then adds every tool schema to the prompt: the base GitHub and Vercel tools, generate_image, generate_audio and generate_video, and every bridge tool. It also adds 3-5 system prompts covering the computer, connectors and media. That is roughly 2-3k prompt tokens, all prefilled on a 2-vCPU Studio before the first word.
- The model is 8B Q4_K_M (5 GB) on 2 vCPU. An earlier comment in `app.py` records 0.41 tok/s, with 7.2 of 8 GB resident.
- The CJK leak: there was no script rule beyond "Reply in the language of the user's last message".

**Changes in branch `fix/minicpm-speed` (app revision r18, shared by all three candidate Studios):**
- Plain-chat fast lane, `_is_plain_chat`: no attachment, no task, media, link or GitHub words, and at most 400 characters. Such a message gets no tools, one short identity and script system prompt, the last 4 turns, and `max_tokens` capped at 320. Anything else keeps the full tool path, unchanged.
- `THREADS` now follows `os.cpu_count()` (capped at 8; override with `DONOR_THREADS`). It used to be hard-capped at 2.
- CJK guard: if the prompt is Arabic and the reply contains CJK, the model is asked once more greedily, then any remaining CJK is stripped. The TS side `stripMixedCjk` in `donorTests.ts` applies the same rule for every candidate.
- TS accepts r17 and r18 during the rollout.

**Next steps:**
1. After the Studio redeploy, measure "مرحبا" and "من انت" on MiniCPM: queue wait, `seconds` and `tokens_per_second` from the result.
2. If decode is still below about 2 tok/s, try a lighter quant (Q3_K_M or IQ4_XS) or MiniCPM-V 4 (4B), in MiniCPM's own repo only.
3. Add a keep-warm ping, and stream first tokens to Telegram.
4. Apply the same fast lane to the LFM2.5 and Sham v2 Studios. Sham v2 leaked Vietnamese; add a Latin-in-Arabic guard there.

### 2026-11-04 05:45 (Istanbul): measurements and follow-up
- **Before (MiniCPM, Studio r17, live through the bot path, run 41761176625):** «من انت» took 177 s end-to-end. The model took 158.9 s, at 0.25 tok/s including prefill. The reply was correct Arabic this time.
- **#683 (6ac843ed):** Studio r18 plain-chat fast lane and CJK guard. The redeploy (run 41760486084) deploys qwen → gemma → minicpm one at a time; the MiniCPM job was still queued at 05:45.
- **#686 (850266c7):** «من انت» / «ما اسمك» / «who are you» are now `trivial`, so they take the lite path (no tools, short system prompt, 200 tokens) on LFM2.5, Nova and Sham v2. `stripThinkTags`, which runs on every send path, now drops CJK and Vietnamese fragments from Arabic replies (`src/lib/scriptGuard.ts`).
- **Next:**
  1. After the MiniCPM job turns green, run `candidate-task-live.yml` (model=minicpmo45) with «مرحبا» and «من انت», and compare `⏱ seconds · token/s`.
  2. If decode is still under about 2 tok/s, switch to `MiniCPM-o-4_5-Q4_0.gguf` (4.77 GB). Q4_0 gets llama.cpp's CPU repacking; it is the lightest quant openbmb publishes, and there is no Q3. Stage it into `novaai2026/sham-donor-minicpmo45-weights` with `stage_candidate_weights.py`, then update `candidates/minicpm-o45.json` and `DONOR_TESTS`.
