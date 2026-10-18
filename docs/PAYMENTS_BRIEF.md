# ملخص تسليم لجلسة «إشراف المدفوعات» (من الجلسة الرئيسية، 2026-10-17)

كتبته الجلسة التي تعمل مع المالك يومياً، من قراءتها للكود ومن كلام المالك. **كل بند مُعلَّم «غير مؤكد» لم أتحقق منه ويجب أن تتحقق منه أنت قبل الاعتماد عليه.** لا توجد هنا أسرار: أسماء متغيرات البيئة فقط، وقيمها يضعها المالك في Vercel ولا تُقرأ.

## 1) أهداف المالك (حرفياً بالمعنى)
- إشراف على كل عمليات الدفع في كل مستودعاته، وتنظيمها، وإصلاح أخطائها.
- ربط **الأرباح النهائية** كلها بمحفظة رقمية واحدة يزوّدك بها هو (عنوان عام فقط).
- أي محفظة فيها شركاء (مثل بوت الإعلان: حصة المشرف 20%): تبقى حصة الشريك كما هي، وتثبيت تحويل **ربحه النهائي هو** لمحفظته.
- لا يريد التشتت: خطة لمحفظة واحدة.

## 2) المستودعات التي تراها الجلسات (GitHub)
`jonsnow-org/Ttbik` (الأهم)، `jonsnow-org/Lena9`، `Brnardtsho/grokyyy`، `Brnardtsho/Mybokyy`. لم أقرأ الثلاثة الأخيرة، فلا أعرف إن فيها أي كود دفع.

## 3) خريطة المسارات المالية في Ttbik (من قراءة الكود)
| المسار | الملفات | ملاحظات |
|---|---|---|
| إيداع TON/USDT-TON الأصلي | `src/services/ton-service.ts`، `src/app/api/cron/ton-deposits/route.ts` | محفظة ساخنة واحدة `MASTER_HOT_WALLET_ADDRESS` وتمييز المودعين بـ memo فريد لكل مستخدم (`User.tonMemo`). المفتاح `MASTER_TON_MNEMONIC` سرّ يتحكم بالمال، ممنوع قراءته. الكرون يومي (حدود خطة Vercel المجانية) فالإيداع قد يتأخر حتى 24 ساعة |
| مسح أرباح المالك | `checkAndSweepOwnerProfits` في `ton-service.ts` | يحوّل `PlatformSettings.accumulatedOwnerProfit` من المحفظة الساخنة إلى `OWNER_CWALLET_ADDRESS` عند تجاوز `OWNER_SWEEP_THRESHOLD` (افتراضي 15$). يُرسل TON ثم يخصم الرصيد في معاملة قاعدة بيانات. **للتحقق:** ماذا يحدث إن نجح الإرسال وفشل الخصم (ازدواج)؟ وتحويل USD→TON وفروق التقريب |
| NOWPayments (عملات متعددة) | `src/lib/nowpayments.ts`، `nowpaymentsSignature.ts`، `src/app/api/payments/*` (create-invoice وwebhook لكل بوت: confession/jobs/marriage/nova)، `src/app/api/orders/*`، `src/app/api/ads/pay`+`ipn` | التحقق بتوقيع IPN (`NOWPAYMENTS_IPN_SECRET`). الاعتماد على `creditOnce` في `src/lib/paymentCredit.ts` (إدراج سجل فريد + منح الرصيد في معاملة واحدة) |
| نجوم تيليجرام (XTR) | `src/lib/starsPayment.ts`، واعتماد pre_checkout في `src/app/api/telegram/[botId]/route.ts` | النجوم تتراكم في رصيد البوت داخل تيليجرام وتُسحب عبر Fragment: **غير مربوطة بأي محفظة** حالياً |
| USDT يدوي (TRC20) | `src/lib/usdtVerify.ts`، `src/app/api/orders/verify-usdt`، `payment-info` | تحقق آلي عبر TronGrid من رقم المعاملة؛ أي فشل يعود للمراجعة اليدوية. العنوان من `USDT_ADDRESS` والشبكة `USDT_NETWORK`. **للتحقق:** منع إعادة استعمال نفس الـ hash (يوجد `usdtHashAlreadyUsed` في orders.ts) |
| طلبات الخدمات | `src/lib/orders.ts` (`decideOrder`) | مصدر موحّد لقبول/رفض الطلب، idempotent |
| إعلانات البنر على الموقع | `src/lib/siteAds.ts`، `src/app/api/ads/*` | دفع NOWPayments أو USDT يدوي، `creditBanner` عند `finished` |
| بوت الإعلان: ربح المهام | `payoutTask` في `src/lib/adBotLogic.ts` | سعر المهمة: **50% للمنفّذ، 20% للمشرف (صاحب صف البوت `Bot.ownerId`) يدخل `pendingBalance` ثم `ownerBalance` بعد 48 ساعة عبر `/api/cron/release-pending-earnings`، 30% للمنصة** يُخصم منها 5% عمولة إحالة المستخدم، ثم 5% من الباقي عمولة B2B لمن أحال تفعيل البوت، والباقي `PLATFORM_PROFIT` ويُضاف إلى `accumulatedOwnerProfit` |
| سحب المشرفين | `💼 أرباحي والسحب` في `adBotLogic.ts` | يمر بموافقة المالك (ردود «موافقة/رفض») |
| بوت الوظائف escrow | `src/app/api/cron/jobs-escrow-release`، `jobsBotLogic.ts` | يحرّر المبلغ للبائع بعد 7 أيام إن لم يُفتح نزاع. إيداعات `jobs-ton-deposits` |
| بوت الزواج | `src/app/api/cron/marriage-ton-deposits`، `matchBotLogic.ts` | إيداع TON وVIP/ترقيات |
| الشراء/التفعيل | `BotPurchase` وأكواد التفعيل في `src/app/api/bots/deploy/route.ts` | كود شراء بالموافقة اليدوية، `SUPER_ADMIN_TELEGRAM_ID` معفى |
| نقاط المنصة | `src/lib/platformPoints.ts` | رصيد نقاط موحّد (ليس مالاً حقيقياً) |
| أثر (NFT على TON) | عقود `athar/**` | **ممنوع المساس بها.** ثمن الصك يُدفع في المعاملة نفسها إلى عنوان المدير العام `EQBt3hzFFJ11GjBjzD523m3NnyhqRNyfKCmzVq9_zVfjQMl2` (موثّق علناً في `docs/ATHAR_OPS_NOTES.md`). أضفنا مراقبة قراءة فقط: `src/lib/atharWatch.ts` و`/api/cron/athar-mints` (تنبيه للمالك في بوت أثر) |

## 4) متغيرات البيئة ذات الصلة (الأسماء فقط)
`MASTER_HOT_WALLET_ADDRESS`، `MASTER_TON_MNEMONIC` (سرّ)، `OWNER_CWALLET_ADDRESS`، `OWNER_SWEEP_THRESHOLD`، `TON_API_KEY`، `TON_NETWORK`، `NOWPAYMENTS_API_KEY`، `NOWPAYMENTS_IPN_SECRET`، `USDT_ADDRESS`، `USDT_NETWORK`، `USDT_JETTON_MASTER_ADDRESS`، `BANK_ACCOUNT_NUMBER`، `BANK_HOLDER`، `SUPER_ADMIN_TELEGRAM_ID`، `TELEGRAM_ADMIN_CHAT_ID`، `CRON_SECRET`.

## 5) ما حدث في هذه الجلسات ويخص المال
- **بوت الإعلان:** تبيّن أن البوت `@AdsClicsBot` (صفّه `4ab07f09`) كان مسجّلاً باسم مشرف (آيدي `8144671083`)، وهو من أنشأه في BotFather. عمولته المتراكمة عند آخر فحص: 0.00 جاهزة + 0.00 محجوزة. حسابه الداخلي فيه رصيد تجريبي 98500$ يقول المالك إنه **تجريبي ويُبقيه**: **تأكد من عدم إمكان سحبه فعلياً.** أنشأ المالك بوتاً خاصاً `@Adm00in0Ownerbot` (صف `fa1ee3a7`) مالكه هو.
- أضفنا في لوحة المالك: «البوتات والمشرفون»، «نقل ملكية هذا البوت»، «لوحة المشرفين (قراءة فقط)»، «بوت خاص بالمالك/عام»، وأمر `/whoami`.
- **أغلقنا ثغرة:** `/api/bots/update-token` كان مفتوحاً بلا مصادقة، وصار يتطلب `CRON_SECRET` ويرفض التوكن المملوك لصف آخر.
- لم نراجع بعد بقية المسارات أعلاه مراجعة أمنية/محاسبية.

## 6) نقاط تستحق الفحص أولاً (فرضيات، لا حقائق)
1. ازدواج/فقدان عند المسح إلى `OWNER_CWALLET_ADDRESS` (الإرسال قبل الخصم).
2. هل كل `webhook` دفع يتحقق من التوقيع ومن المبلغ والعملة والحالة `finished` ومن أن الطلب لم يُعتمد من قبل؟
3. مسارات `create-invoice` و`update-token` وأي `GET` يغيّر حالة: هل هي محمية؟
4. تكرار استعمال معاملة USDT نفسها عبر طلبات مختلفة.
5. تقريب `round2` وحسابات النسب في `payoutTask` (مجموع النسب = السعر؟).
6. رصيد المشرف المتراكم على صفوف يملكها المالك نفسه.
7. أي مكان يُعرض فيه أو يُسجَّل سرّ أو رقم حساب (`BANK_ACCOUNT_NUMBER`) علناً.
8. نجوم تيليجرام: لا يوجد مسار لسحبها؛ المطلوب وثيقة خطوات للمالك (Fragment).

## 7) ما ينقصني ولا أعرفه
- حالة قاعدة البيانات الحقيقية (Supabase): أرصدة، معاملات عالقة، `accumulatedOwnerProfit` الحالي. اطلب من المالك نتائج استعلامات SQL قراءة فقط، واكتبها له في ملف.
- أي كود دفع في المستودعات الثلاثة الأخرى.
- عنوان المحفظة النهائية وشبكتها: لدى المالك، لا تخمّنهما.
