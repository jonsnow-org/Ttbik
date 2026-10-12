# إطلاق عملة زنوبيا (ZNB) على Blum Memepad: حزمة الإطلاق

آخر تحديث: 2026-10-12. الإطلاق **بيدك أنت**: لا أطلقه ولا أشتري ولا أبيع. يتم من تطبيق Blum في تيليجرام بمحفظتك، ولا يوجد لـBlum واجهة برمجية أستطيع الوصول إليها.

## ما تغيّر عن الخطة القديمة
- **لا ننتظر 300 مشترك.** نطلق الآن، وتبقى القناة والبوت قمع جذب فقط.
- **العدد 1,000,000,000 (مليار) ثابت، وليس 9 مليار.** مصادر Blum الرسمية: المنشئ لا يختار العدد، وكل عملة مليار: 800 مليون على منحنى السعر و200 مليون مع 1,450 TON تُضاف سيولة تلقائيًا عند بلوغ 1,500 TON.
- لا سيولة منك. رسم الإطلاق 0.5 TON، ورسم البيع والشراء 1%.

## قبل أن تبدأ (ثلاثة أشياء)
1. محفظتك (My Wallet) فيها **نحو 1 TON على الأقل**: 0.5 رسم الإطلاق + رسوم الشبكة. وأي «حصة أولية» تشتريها بنفسك تُضاف إليها.
2. الصور محفوظة على هاتفك (حملها من الروابط): الأيقونة `https://ttbik.vercel.app/zenobia/coin-icon.png`، والغلاف `https://ttbik.vercel.app/zenobia/banner.jpg`.
3. حدّد **الحصة الأولية** (حقل Token share، بين 0 و1000 TON): هي شراؤك أنت كأول مشترٍ. 0 تعني أنك لا تشتري شيئًا. القرار لك، ولا وعد بأي عائد منها.

## الحقول: انسخها كما هي
| الحقل في Blum | القيمة |
|---|---|
| **Name** | `Zenobia` |
| **Ticker** | `ZNB` |
| **Icon** | coin-icon.png (الرابط أعلاه) |
| **Banner** | banner.jpg (الرابط أعلاه) |
| **Description** | `Zenobia (ZNB): a community coin inspired by Zenobia, queen of Palmyra, and the Silk Road. Holders can get a limited Silk Road Passport NFT. Not financial advice. Crypto is risky.`<br>`زنوبيا (ZNB): عملة مجتمعية مستوحاة من زنوبيا ملكة تدمر وطريق الحرير. لحامليها جواز طريق الحرير (NFT محدود). ليست نصيحة مالية، والعملات الرقمية محفوفة بالمخاطر.` |
| **Social links** | القناة `https://t.me/Zenobiaton`، والجواز `https://ttbik.vercel.app/zenobia/silk.html` |
| **Token share** | قرارك (0 إلى 1000 TON) |

إن رفض الحقل طول الوصف فاقصره إلى الجملة الإنجليزية الأولى والعربية الأولى. لا تكتب فيه أي وعد بعائد أو ارتفاع سعر.

## الخطوات في Blum (من وصف FAQ الرسمي)
1. افتح Blum ← **Memepad** ← **Launch Token**.
2. أدخل الحقول أعلاه (Icon, Name, Ticker, Description, Banner, Social).
3. اختر الحصة الأولية، ثم **Launch**، ووافق على المعاملة في محفظتك، وانتظر التأكيد.
4. افتح صفحة العملة الناتجة وانسخ **عنوان العقد** (يبدأ بـ EQ). هذا كل ما أحتاجه منك.

## بعد الإطلاق: ما أفعله أنا عند وصول العنوان
1. **أتحقق من العملة على السلسلة** (العدد، الخانات، الاسم والصورة) من tonapi.
2. أضبطها في البوت: `/jetton العنوان` فتبدأ اللقطات اليومية ولوحة القافلة.
3. أحدد **الحد الأدنى لشراء الجواز** بـ`/silkmin` بحسب سعر السوق، وأفتحه بـ`/silk on`.
4. أنشر مجموعة جوازات طريق الحرير بإنشاء ملف التفعيل (0.04 GRAM من محفظة السجل) **بعد أمرك**.
5. **فحص الحرق:** تحرق مبلغًا صغيرًا جدًا من ZNB لنتأكد أن قالب Blum يدعم الحرق (يلزم للترحيل المستقبلي إلى العقد الخاص).
6. أضبط وصف العملة وأيقونتها على tonapi إن ظهرت قديمة، وأخبرك إن احتاجت أمرًا منك.

## منشورات الإطلاق (إنجليزية أولًا، بلا وعد ربح)
**منشور الإطلاق**
```
🏛 Zenobia (ZNB) is live.
A community coin inspired by Zenobia, queen of Palmyra, and the Silk Road.
Buy / trade: <رابط Blum للعملة>
Silk Road Passport (limited, tradable NFT for holders): https://ttbik.vercel.app/zenobia/silk.html
Caravan Board (longest holders): https://ttbik.vercel.app/zenobia/hall.html
Not financial advice. Crypto is risky; only use what you can afford to lose.

🏛 انطلقت عملة زنوبيا (ZNB).
عملة مجتمعية مستوحاة من زنوبيا ملكة تدمر وطريق الحرير.
الشراء والتداول: <رابط Blum للعملة>
جواز طريق الحرير (NFT محدود وقابل للبيع للحاملين): https://ttbik.vercel.app/zenobia/silk.html
لوحة القافلة (الأطول احتفاظًا): https://ttbik.vercel.app/zenobia/hall.html
ليست نصيحة مالية. العملات الرقمية محفوفة بالمخاطر، ولا تستخدم إلا ما تتحمل خسارته.
```
**منشور الجواز (بعد فتحه)**
```
🪪 Silk Road Passport · From Palmyra
2,500 only. Grows with its age: Child → Queen → Warrior. Locked for the first 30 days (enforced by the contract), then free to trade. Shows as Captive if its holder holds no ZNB.
Get yours with your wallet: https://ttbik.vercel.app/zenobia/silk.html

🪪 جواز مرور طريق الحرير من تدمر
2,500 فقط. يكبر بعمره: طفلة ثم ملكة ثم محاربة. يُقفل أول 30 يومًا (يفرضه العقد) ثم يُباع ويُشترى بحرية. يظهر أسيرًا إن لم يملك حامله ZNB.
احصل عليه بمحفظتك: https://ttbik.vercel.app/zenobia/silk.html
```

## ما لا يتحقق من هذا المسار (بصراحة)
- العملة قياسية: لا خصائص داخل عقدها. الجواز ولوحة القافلة والترتيب تعمل حولها، ولا تتوقف المحفظة العادية بسببها.
- أغلب العملات على المنصات المماثلة لا تصل إلى الإدراج على STON.fi (مقال وجدتُه يذكر نحو 0.16%)، والعقبة هي الجمهور لا العقد.
- لا أعد بأي ربح ولا أستطيع تقدير احتمال النجاح.
