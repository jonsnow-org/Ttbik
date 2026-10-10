# أثر: ملاحظات تشغيل من أحداث 6–10 أكتوبر 2026

## من ينشر ماذا
| الجزء | يتبع أي فرع | أين يعمل |
|---|---|---|
| موقع أثر (التطبيق المصغّر، API، العارض) | `main` | خادم Oracle (يبنيه تلقائياً) |
| بوت أثر على تيليجرام، مرآة `/api/athar/*`، `/api/ops/athar-health` | **الفرع الافتراضي** `claude/free-services-marketplace-h6rwk2` (الإنتاج على Vercel) | Vercel |
| العقود | لا تُنشر من الفروع: عناوينها على السلسلة | TON mainnet |

لذلك أي تعديل في `src/lib/atharBotLogic.ts` أو ملفات أثر يلزمه دمج `main` في الفرع الافتراضي حتى يظهر في البوت. الدمج الأخير: PR #88. عند التعارض في ملفي الأخبار والأحداث (`src/lib/newsItems.ts`، `src/lib/eventsIndex.ts`) يُؤخذ ما في الفرع الافتراضي (تكتبه جلسات أخرى).

## قبل أي دمج
1. `cd athar/web && npx next build --webpack` (لا يكفي `tsc --noEmit`: Next 16 يرفض أشياء مثل قراءة `searchParams` في layout عند البناء فقط. هذا ما أسقط بناء Oracle بعد PR #82).
2. `cd athar && npx jest`، وللبوت: `npx jest --config ../jest.media.config.js --rootDir .. atharBot`.
3. في الفرع الإنتاجي: `npx tsc --noEmit` ويُتجاهل ضجيج Prisma (`siteBannerAd`) في نسخة بلا `prisma generate`.

## عبر محرر الجوال في GitHub
محرر الجوال يفكّ رموز HTML عند اللصق (`&amp;` تصير `&`)، فأسقط بناء الإنتاج في `LogoGenerator.tsx` ثلاث مرات (أُصلح في PR #87). لا يُعدَّل كود عبره.

## العناوين الحقيقية على الشبكة الرئيسية
- المجموعة: `EQAeT5hxl1yyBLNjl56enA_CS_Ofb-nRArcJuF2V5mVtVjfv`
- البائع: `EQC_vX-C0nzHUj-C_KNywG-STBK-bBPLhjHat_orVgFPPvJ3`
- المدير: `EQBt3hzFFJ11GjBjzD523m3NnyhqRNyfKCmzVq9_zVfjQMl2` (هي نفسها `UQBt3hz…QJSz`)
- رابط البيانات `NEXT_PUBLIC_ATHAR_META_BASE=https://athar-meta.jonsnowx1r.workers.dev` ومدة الإشعار الافتراضية 172800.
- فحص: `https://ttbik.vercel.app/api/ops/athar-health` يجب أن يكتب `derived.collection` بالعنوان أعلاه (إن اختلف فالإنتاج على شيفرة أثر قديمة).

## «رموزي» فارغة؟
الصفحة تعرض رموز المحفظة المربوطة. الرمز المعروض للبيع على Getgems يحتفظ به عقد البيع لكن يُحسب لصاحبه. وإن نُقل الرمز إلى محفظة أخرى فلا يظهر إلا بربط تلك المحفظة. التحقق: `GET /api/me?address=<محفظة>` وسجل نقل الرمز من `tonapi.io/v2/nfts/<عنوان الرمز>/history`.

## الخارج عن الشيفرة
- توثيق المجموعة عند Tonkeeper: PR #6458 في `tonkeeper/ton-assets` من حساب المالك الشخصي.
- ما يسمح بالدفع اليدوي فقط (مفتاح Toncenter، وبوت الإشعارات) يضعه المالك في لوحة الإدارة وVercel.
