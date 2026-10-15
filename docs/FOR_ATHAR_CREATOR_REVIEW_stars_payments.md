# مواصفات دفع نجوم تيليجرام في أثر — المرحلة A (لمهندس أثر)

> **التنفيذ يكون على الفرع `claude/athar-work` فقط، بواسطة جلسة أثر.** هذا الملف توثيق فقط، ولا يغيّر أي كود.
> العقود الحية لا تتغير. مسار الدفع بالعملات الرقمية الحالي لا يتغير سلوكه.

## 1. النطاق
- الفئات: `normal` و`silver` و`gold` فقط. لا `mystery` ولا `auction`.
- المسار: فاتورة نجوم (`XTR`) ← طلب مدفوع في الطابور ← المشرف يوقّع `AdminMint` عبر TonConnect ← تسليم الرمز.
- العلم: `ATHAR_ENABLE_STARS`، وقيمته الافتراضية `0`. عند إطفائه لا يظهر زر الدفع، ويرفض البوت أي `pre_checkout_query` برسالة لطيفة.

## 2. البوت (`atharBotLogic.ts`)
1. **إنشاء الفاتورة:** `createInvoiceLink` أو `sendInvoice` بالقيم `currency: "XTR"` و`provider_token: ""`.
   - `payload` = `order_id` (معرّف UUID)، **ولا يحمل أي سعر**.
   - يُنشأ الطلب بالحالة `pending` قبل إصدار الفاتورة.
   - يُحجز التاريخ (القسم 4) قبل إصدار الفاتورة.
2. **`pre_checkout_query`:** يجب الرد خلال **10 ثوانٍ**. قبل الموافقة يتحقق البوت مما يلي:
   - العلم مفعّل.
   - الطلب موجود وحالته `pending`.
   - `from.id` يطابق `tg_user_id` في الطلب.
   - `total_amount` يطابق `stars_amount`.
   - الحجز ما زال سارياً.
   - التاريخ غير مسكوك على السلسلة (من الذاكرة المؤقتة، ويُتحقق منه بسرعة).

   إذا فشل أي شرط: `ok:false` مع `error_message` عربي.
3. **`successful_payment`:**
   - تحديث ذري:
     ```sql
     UPDATE ... SET status='paid', telegram_payment_charge_id=$1, paid_at=now()
     WHERE id=$order AND status='pending'
     ```
   - إذا لم يتأثر أي صف، فهذا تكرار: يُتجاهل ويُسجَّل.
   - الحجز يُمدَّد إلى «محجوز حتى السك».
   - رسالة للمستخدم: «تم الدفع، سيُسك رمزك قريباً».
4. **Webhook:** تيليجرام قد يعيد إرسال التحديث. منع التكرار يعتمد على قيد UNIQUE على `telegram_payment_charge_id`، لا على `update_id`.

## 3. جدول جديد فقط (بلا تعديل الجداول القائمة)
```sql
CREATE TABLE IF NOT EXISTS athar_star_orders (
  id                          uuid PRIMARY KEY,
  idempotency_key             text NOT NULL UNIQUE,   -- = 'stars:' || id
  tg_user_id                  bigint NOT NULL,
  date_index                  int NOT NULL CHECK (date_index BETWEEN 0 AND 36524),
  tier                        text NOT NULL CHECK (tier IN ('normal','silver','gold')),
  stars_amount                int NOT NULL CHECK (stars_amount > 0),
  recipient_address           text NOT NULL,          -- عنوان TON للمستلم، يُتحقق منه عند الإنشاء
  status                      text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','paid','minting','minted','refund_pending','refunded','expired','failed')),
  telegram_payment_charge_id  text UNIQUE,
  mint_tx_hash                text,
  mint_claimed_by             text, mint_claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz, minted_at timestamptz, refunded_at timestamptz,
  last_error text
);
-- طلب حي واحد فقط لكل تاريخ
CREATE UNIQUE INDEX IF NOT EXISTS athar_star_orders_live_date
  ON athar_star_orders(date_index)
  WHERE status IN ('pending','paid','minting','minted');
```

## 4. الحجز المشترك مع مسار العملات الرقمية (منع البيع المزدوج)
- **جدول جديد:**
  ```sql
  athar_date_locks(date_index int PRIMARY KEY, holder text NOT NULL, expires_at timestamptz NOT NULL)
  ```
  - `holder` = `stars:<order_id>` أو `crypto:<ref>`.
- **أخذ القفل:**
  ```sql
  INSERT ... ON CONFLICT (date_index) DO UPDATE SET holder=EXCLUDED.holder, expires_at=EXCLUDED.expires_at
  WHERE athar_date_locks.expires_at < now()
  ```
  - إذا لم يتأثر أي صف، فالتاريخ محجوز ويُرفض الطلب.
- **مدة الحجز (TTL):**
  - 15 دقيقة قبل الدفع.
  - بعد الدفع يُمدَّد إلى 7 أيام، أو يُضبط على `infinity` حتى السك أو الاسترداد.
- **مسار العملات الرقمية:** التغيير الوحيد المطلوب فيه، وهو **إضافي**، أن يقرأ القفل قبل عرض الدفع. إذا كان التاريخ محجوزاً بنجوم يُعرض له «محجوز مؤقتاً». لا يتغير سلوكه في أي حالة أخرى. ويُفضَّل أن يأخذ هو أيضاً قفلاً بالصيغة `crypto:` نفسها.
- **قبل `AdminMint` مباشرة:** يُستعلم من العقد أو المؤشر عن عنوان عنصر NFT لهذا `date_index`.
  - إذا كان مسكوكاً: الحالة تصبح `refund_pending`، ولا يُوقَّع شيء.

## 5. طابور توقيع المشرف (منع السك المزدوج)
- **الصفحة:** صفحة مشرف داخل تطبيق أثر خلف الحماية الحالية. تعرض الطلبات `paid` الأقدم أولاً.
- **الحجز للتوقيع:**
  ```sql
  UPDATE ... SET status='minting', mint_claimed_by=$admin, mint_claimed_at=now()
  WHERE id=$1 AND status='paid'
  ```
  - المطالبة (claim) ذرية.
- **التحقق:** تحقق من السلسلة (القسم 4)، ثم بناء رسالة `AdminMint` من `athar/web/lib/tx.ts` كما هي، ثم التوقيع عبر TonConnect.
- **بعد الإرسال:**
  - يُخزَّن `mint_tx_hash`.
  - مهمة مجدولة (cron) تتحقق من العنصر على السلسلة، ثم تضبط الحالة على `minted`.
- **التعليق:** طلب في حالة `minting` لأكثر من 30 دقيقة بلا tx **لا يعود تلقائياً إلى `paid`**.
  - يُعرض للمشرف كـ«بحاجة مراجعة».
  - يتحقق المشرف من السلسلة أولاً، ثم يختار «إعادة المحاولة» أو «استرداد».
- **التسليم:** يُرسل للمستخدم رابط الرمز بعد `minted`.

## 6. الاسترداد (`refundStarPayment`)
- **متى:** يُسمح به فقط إذا كانت الحالة `paid` أو `refund_pending`، أو `minting` بعد تأكيد أن الرمز غير مسكوك على السلسلة.
- **الاستدعاء:**
  ```
  refundStarPayment(user_id=tg_user_id, telegram_payment_charge_id)
  ```
- **بعد النجاح:** الحالة تصبح `refunded`، ويُحرَّر قفل التاريخ.
- **الفشل:** يُسجَّل في `last_error` ويُعاد المحاولة يدوياً.
- **حالات تلقائية:**
  - الطلب `paid` بلا سك لأكثر من 7 أيام: يصبح `refund_pending` ويُنبَّه المشرف.
  - الطلب `pending` لأكثر من 15 دقيقة: يصبح `expired` ويُحرَّر القفل.
- **ممنوع** الاسترداد بعد `minted`.

## 7. اقتراح الأسعار بالنجوم
- **التحويل:** يُحسب من سعر TON الحالي، مع هامش يغطي عمولة تيليجرام وفرق تحويل النجوم (تقريباً 0.013 دولار للنجمة عند السحب).
- **مقترح أولي** (يضبطه المالك):

  | الفئة | السعر بالنجوم |
  |---|---|
  | `normal` | 250 ⭐ |
  | `silver` | 750 ⭐ |
  | `gold` | 2000 ⭐ |

- **مصدر الأسعار:** ثابتة في متغير `ATHAR_STARS_PRICES`، تُقرأ من الخادم ولا تُقبل من العميل.
- **الصياغة:** هدية وذكرى، بلا حديث عن استثمار أو عائد.

## 8. خطة الاختبار
1. وحدات:
   - رفض الفاتورة عند إطفاء العلم.
   - رفض `pre_checkout` عند عدم تطابق المبلغ أو المستخدم أو انتهاء القفل.
   - `successful_payment` المكرر لا يغيّر شيئاً.
2. تزامن: طلبان، نجوم + عملات رقمية، على التاريخ نفسه. ينجح واحد فقط في أخذ القفل.
3. السك المزدوج: مشرفان يطالبان بالطلب نفسه، ينجح واحد فقط. تاريخ مسكوك مسبقاً على السلسلة ينتقل إلى `refund_pending`.
4. الاسترداد: النجاح، والفشل ثم إعادة المحاولة، ومنع الاسترداد بعد `minted`.
5. شبكة الاختبار: سك فعلي عبر `jest.testnet.config.js`، ثم بوت اختبار بنجوم تيليجرام في بيئة الاختبار.
6. انحدار: مسار الدفع بالعملات الرقمية الحالي يعمل كما كان والعلم مطفأ ومفعّل.

## 9. المخاطر
- **مفتاح مشرف واحد:** المفتاح الذي يوقّع `AdminMint` نقطة فشل واحدة. فقدانه يوقف التسليم، وسرقته تسمح بالسك.
  - الاقتراح: سقف يومي للسك، وتنبيه على كل `AdminMint`.
- **لا تدقيق خارجي** للعقود ولا لهذا المسار. يُنصح بمراجعة قبل التفعيل.
- **`CRON_SECRET` في رابط URL:** قد يظهر في السجلات. يُفضَّل نقله إلى ترويسة `Authorization`.
- **تأخر السك** بسبب الاعتماد على توقيع يدوي يضعف تجربة المستخدم. لذلك يجب إبلاغه بمهلة واضحة، ومسار الاسترداد التلقائي ضروري.
- **سياسة تيليجرام:** السلع الرقمية داخل تيليجرام تُدفع بالنجوم فقط، وهذا متوافق. أما ربط الدفع بالنجوم برمز على السلسلة فيُراجع مع شروط تيليجرام.

## 10. التفعيل
1. دمج التنفيذ في `claude/athar-work` ثم `main` عبر PR.
2. تنفيذ مهاجرة SQL الإضافية.
3. ضبط `ATHAR_STARS_PRICES`.
4. ضبط `ATHAR_ENABLE_STARS=1`.
5. إعادة النشر.
