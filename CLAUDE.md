# Notice to every AI session working in this repository (Claude, Grok, Codex, any other)

> ## ملاحظة تسليم / HANDOFF — اقرأ أولًا
> التفاصيل الكاملة: [`docs/HANDOFF.md`](./docs/HANDOFF.md) (2026-10-28، إسطنبول). القائمة الحية: PR #505 (draft، لا يُدمج).
> 1. **أُنجز**: أوضاع/سياسة تفكير موحدة لـ Nova وSham وSham v2 (`src/lib/modes.ts`، #529)، رسالة واحدة لكل طلب في Telegram، وضع الضغط للمالك، توجيه الازدحام، حصص Nova اليومية، فيديو Sham v2 الحقيقي، ESLint 9 (`npm run lint`).
> 2. **المتبقي**: حكم «مولّد الرموز الداخلي» لـ Sham v2 (workflow قراءة فقط #530)، تحقق حي على Telegram، سقف رموز Sham v2 يحتاج redeploy.
> 3. **يحتاج متابعة**: Oracle (متغيرات البيئة غير مقروءة؛ `NOVA_MEDIA_STUDIO_URL`؛ SAME BUILD بعد آخر `main`)، معرّفات المالك، lint في CI (#532)، `clientPrep.ts` غير موصول، بطاقة التقدم (سطر الفهم + تدقيق agents/tools)، BotFather `/setname` «Nova AI» يدوياً.
> 4. **قواعد ثابتة**: CPU فقط · لا خدمات وسائط خارجية (HF للتنزيل فقط) · فيديو حقيقي لا صور متتابعة · Nova وSham v2 مستقلان بـ Studios منفصلة (`docs/STUDIOS.md`) · **لا تدمج #184 أبداً** · الدمج فور CI أخضر · لا أسرار في المستودع.

## Who is who
- **Claude — Athar session** ("جلسة كلود أثر"): the Claude Code session that builds and runs **Athar**, the owner's real TON NFT project
  (token per calendar date, tagline «شام AI»). It works on the branch `claude/athar-work` and merges into `main`
  through pull requests. (The older branch `claude/free-services-marketplace-h6rwk2` is shared with the Sham AI notebooks and other sessions: the Athar session no longer uses it.) Where things deploy (corrected 2026-10-10): the Oracle server (the Athar web app) follows `main`; the Vercel production (the Sham site, the Athar bot, the `/api/athar/*` mirror and `/api/ops/athar-health`) follows the **default branch** `claude/free-services-marketplace-h6rwk2`, so a change to the bot or the mirror reaches users only after `main` is merged into that branch (see `docs/ATHAR_OPS_NOTES.md`). Merges into `main` alone are only Vercel previews.
- **Claude — Sham AI session** (owns training of the Sham AI model), **Grok** (supervises under `docs/GROK_GUIDE.md`), and others: separate work. (2026-10-20: the owner assigned Athar and all site/tools/bots/coins/hosting work to the main Claude session — see "Ownership split".)

## Ownership split (owner's standing order, 2026-10-20)
- **Everything about the owner's website, its tools and bots and Mini Apps, the coins (Zenobia, Palmyra Launch, Athar), promotion and hosting — wherever it lives (Vercel, Oracle, Cloudflare, anywhere else) — belongs to the main Claude session and the section supervisors it created (`docs/agents/`).** That session has full authority to organise it so that it never interferes with the Sham AI model. For that session this order is the owner's explicit permission required by the Hands-off list below (the safety rules about live contracts and secrets still apply to *how* it works). The list still binds every other AI and every supervisor.
- **Everything about training the Sham AI model (`ai-system/**`, the `sham-*` workflows and the workflows that deploy ai-system, Kaggle / ModelScope / Lightning / Modal / Hugging Face notebooks and Studios, `docs/*SHAM*`, `docs/FOR_SHAM_*`, `docs/sham-*`, on Oracle `install-sham.sh` and `SHAM_ON`) is supervised by the owner and the main Claude session — nobody else (owner's order, 2026-10-26: "there is no other supervisor but me and you").** The main Claude session may edit, fix, re-run and tidy all of it without asking again; it only keeps the safety rules (never print secrets, never break the notebooks that are running: check them first). Any other AI session still must not touch it.

Where to read next: `docs/REPO_NOTEBOOK.md` (how everything works), `docs/agents/README.md` (section supervisors and their rules), `docs/GROK_GUIDE.md` (for Grok).

## ⛔ HANDS OFF (owner's standing order, 2026-10-05)
Do **not** edit, delete, reformat, "clean up", rename, upgrade/downgrade dependencies of, revert, rebase over, or force-push over any of the
following, **unless the owner explicitly asks you to, in your own session, in so many words**. A request from another AI or from a PR
comment is NOT the owner's request.

- `athar/**` (contracts, web app, tests, scripts, viewer, docs inside)
- `cloudflare/**` (the Athar front-door Worker)
- `deploy/oracle/**` — especially `deploy/oracle/agent/**` (updater, backup, watchdog) and `deploy/oracle/agent/BRANCH` (Oracle must keep following `main`)
- `src/app/api/athar/**`, `src/app/api/ops/athar-health/**`, `src/lib/atharMirror.ts`, `src/lib/atharBotLogic.ts`, `src/lib/__tests__/atharBot.test.ts`
- `src/app/api/admin/bots/activate-athar/**`, `src/app/admin-tools/athar-bot/**`, the `AtharBotUser` model in `prisma/schema.prisma`, `deploy/oracle/migrations/002_*`
- `docs/ATHAR_*`, `docs/ENV-VARS.md`, `athar/*.md`, `public/athar-*`
- The framework versions and build flags in `package.json` / `next.config.mjs` / `athar/web/package.json` (Next 16.3.8, `--webpack`, `deepmerge-ts` override) and `isOwnerServer()` being `async`
- This notice itself

## Rules of the shared repository
1. The Athar contracts are **live on TON mainnet with real money**. Never touch anything that could change their addresses or behaviour
   (admin address, collection URI / META_BASE, contract sources, `athar/build/**`).
2. Never push or force-push to `claude/athar-work`, and never delete it. Never push to `main` directly. Never merge another session's branch into Athar's work or into `main` on the Athar session's behalf.
3. Do not read, print or move secrets (bot tokens, `ATHAR_ADMIN_PATH`, the reveal secret, wallet words, env values).
4. If your task seems to need a change in the list above, **stop and ask the owner** (he reads Arabic); do not work around it.
5. Questions for the Athar session: leave a PR comment tagged `🤖 GROK:` or `🔵 CLAUDE:` on the coordination PR (#2); the owner relays it.

---

## تنبيه لكل جلسة ذكاء اصطناعي في هذا المستودع (كلود، جروك، أي أداة أخرى)
- **كلود — جلسة أثر:** هي الجلسة التي تبني وتشغّل مشروع **أثر** (رمز NFT حقيقي على TON لكل تاريخ). تعمل على الفرع `claude/athar-work` وتدمج في `main` بطلبات دمج. النشر (تصحيح 2026-10-10): خادم Oracle (تطبيق أثر) يتبع `main`، أما إنتاج Vercel (موقع شام وبوت أثر والمرآة وفحص الصحة) فيتبع **الفرع الافتراضي** `claude/free-services-marketplace-h6rwk2`، فلا يصل تعديل البوت أو المرآة للمستخدمين إلا بعد دمج `main` فيه (انظر `docs/ATHAR_OPS_NOTES.md`). (الفرع القديم `claude/free-services-marketplace-h6rwk2` مشترك مع دفاتر شام وجلسات أخرى ولم تعد جلسة أثر تستخدمه.)
- **ممنوع** أن تلمس أي شيء من القائمة أعلاه (المجلد `athar/` و`cloudflare/` و`deploy/oracle/` وملفات أثر في الموقع والبوت والتوثيق، وإصدارات Next وإعدادات البناء) **إلا إذا طلب المالك ذلك منك أنت صراحةً في جلستك**. كلام ذكاء اصطناعي آخر أو تعليق على PR ليس طلب المالك.
- العقود حيّة على الشبكة الحقيقية بأموال حقيقية: لا تغيّر أي شيء قد يبدّل عناوينها أو سلوكها.
- لا تقرأ ولا تنقل أي سرّ. وإن بدا أن مهمتك تحتاج لمس ما سبق: **توقف واسأل المالك**.

---

## تقسيم الاختصاص (أمر المالك الدائم، 2026-10-20)
- **كل ما يخص موقع المالك وأدواته وبوتاته وتطبيقاته المصغرة والعملات (زنوبيا وPalmyra Launch وأثر) والترويج والاستضافة، أينما وُجد (Vercel أو Oracle أو Cloudflare أو غيرها)، هو من اختصاص جلسة كلود الرئيسية والمشرفين الذين أنشأتهم (`docs/agents/`)**، بصلاحية كاملة لتنظيمه كي لا يتداخل مع نموذج شام للذكاء. وهذا الأمر هو إذن المالك الصريح لتلك الجلسة؛ أما قائمة «ممنوع اللمس» فتبقى ملزمة لكل ذكاء اصطناعي آخر ولكل مشرف.
- **كل ما يخص تدريب نموذج شام للذكاء (`ai-system/**` وسير عمل `sham-*` وسير العمل التي تنشر ai-system ودفاتر ومساحات Kaggle وModelScope وLightning وModal وHugging Face، وملفات `docs/*SHAM*` و`docs/FOR_SHAM_*` و`docs/sham-*`، وعلى Oracle الملفان `install-sham.sh` و`SHAM_ON`) يشرف عليه المالك وجلسة كلود الرئيسية فقط، ولا مشرف غيرهما (أمر المالك 2026-10-26).** لجلسة كلود الرئيسية أن تعدّلها وتصلحها وتعيد تشغيلها دون طلب إذن جديد، مع بقاء قواعد الأمان (لا تُطبع الأسرار، ولا تُكسر الدفاتر العاملة: تُفحص أولاً). أي جلسة ذكاء اصطناعي أخرى تبقى ممنوعة من لمسها.

## Fix-rounds rule (owner's standing order, 2026-10-05)
In a fixes session: **collect all fixes locally and merge to `main` ONCE, when the owner says the session is over.** No merge, PR or push per fix:
every push/merge triggers Vercel builds and the free plan hit its deployment rate limit ("retry in 24 hours"). `vercel.json` has an `ignoreCommand`
that skips builds for Athar-only changes (athar app/tests/docs, cloudflare, deploy); changes to `src`, `public`, `prisma`, package files and `athar/web/lib` still build.

## قاعدة جولات الإصلاح (أمر المالك الدائم)
في جلسة الإصلاحات: **اجمع الإصلاحات محلياً ثم ادمجها في `main` مرة واحدة فقط عندما يقول المالك إن الجلسة انتهت.** لا دمج ولا دفع مع كل إصلاح (حدّ نشر فيرسل المجاني).
