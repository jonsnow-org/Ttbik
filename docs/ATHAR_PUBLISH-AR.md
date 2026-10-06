# نشر أثر: كيف يجده الناس (2026-10-05)

الحقيقة التي بحثتُ عنها في مصادرها: **الأسواق والمحافظ تفهرس كل مجموعة تلقائياً من السلسلة**، فلن تبقى أثر «مخفية في البوت». لكن الظهور في القوائم المميزة له شروط. هذا ما يلزم وما نفّذتُه وما ينتظر منك.

## 1. ما هو تلقائي (لا يلزم تقديم شيء)
- **Getgems و Tonviewer و Tonkeeper و MyTonWallet و Telegram Wallet**: تقرأ المجموعة وصورها من العقد وبياناتنا، فيجدها كل من يملك رمزاً أو يفتح عنوان المجموعة أو الرمز.
- **Getgems «Top Collections»:** كل مجموعة تدخل الترتيب **بعد أول عملية بيع على Getgems**، ويرتفع ترتيبها بحجم التداول. مبيعاتنا الأولى من موقعنا لا تُحسب عندهم؛ **التداول الثانوي على Getgems هو الذي يرفعنا**: ضع بعض الرموز للبيع هناك بنفسك (خصوصاً الذهبية الشمعية).

## 2. ما نفّذتُه في الكود اليوم
- **بيانات المجموعة** (يقرؤها Getgems وغيره) فيها الآن: `social_links` (بوت تيليجرام) و`cover_image` و`external_url`. هذا شرط Getgems للقائمة الرئيسية («روابط التواصل داخل بيانات المجموعة»).
- **صورة PNG مباشرة** لكل رمز وللمجموعة (`/img/collection.png`، `/api/live/<رقم>.png`): الأدلة وTonkeeper تطلب رابط صورة مباشراً، وبعض المحافظ ترسم الصور النقطية فقط، ومعاينات الروابط على تيليجرام وX وواتساب لا تعرض SVG.
- **معاينة الرابط عند المشاركة:** كل صفحة رمز لها عنوان وصورة PNG خاصة بها، وللموقع بطاقة عامة.
- **`robots.txt` و`sitemap.xml`** يعرّفان محركات البحث بالصفحات الرئيسية وبكل رمز مصكوك.
- ضبط تموضع الصور وملء الدائرة تلقائياً (لا فراغات).

## 3. خطواتك، بالترتيب (كل واحدة مجانية)
1. **حساب عام على X وقناة على تيليجرام** باسم Athar. ضع رابطيهما في بيانات المجموعة (أخبرني بهما وأضيفهما، الحد 10 روابط). وانشر **منشوراً واحداً** يشرح فكرة المشروع (شرط Getgems). مسودتا المنشور في الأسفل.
2. **Tonkeeper (إزالة وسم Unverified):** طلب سحب (Pull Request) إلى `github.com/tonkeeper/ton-assets` يضيف ملف YAML للمجموعة في مجلد `collections/` بالاسم والعنوان ورابط صورة مباشر `https://athar-meta.jonsnowx1r.workers.dev/img/collection.png` والوصف والروابط. مجاني، ويراجعونه بالدور. انظر أي ملف موجود في ذلك المجلد وانسخ صيغته. عنوان مجموعتنا: `EQAuIOwjzSmGQfL925LjD5eG0Qk1zJNRk4Ap8jzSOwnCRIYf`.
3. **Getgems «Explore» (القائمة الرئيسية):** عبر بوت الدعم `@nfton_bot`. الشروط: 10 رموز على الأقل بنفس الطابع **معروضة للبيع**، وحجم مبيعات 10 Gram على الأقل، وعمل أصلي، وروابط تواصل داخل بيانات المجموعة (✓)، ومنشور واحد على الأقل (الخطوة 1). **اعرض على Getgems ما لا يقل عن 10 رموز للبيع** ثم قدّم الطلب.
4. **توثيق Getgems (العلامة الزرقاء):** لاحقاً: 10 مالكين مختلفين على الأقل وحجم تداول فوق 10,000 Gram، وعبر `@nfton_bot` أيضاً. لا يمكن تعجيله، لكنه يأتي مع النمو.
5. **دليل التطبيقات:** سجّل أثر كتطبيق مصغر على DappRadar و ton.app (نموذج «Submit»). ومن BotFather نفّذ `/newapp` لتحصل على رابط مباشر للتطبيق المصغر داخل البوت.
6. **نطاق (دومين) حقيقي:** عنوان الموقع الحالي مبني على رقم الخادم (`sslip.io`)، فيبدو غير موثوق ويفهرسه البحث ببطء. اشترِ نطاقاً (نحو 10 دولارات في السنة) وأربطه بـCloudflare، وأربطه أنا بالموقع. هذا أكبر تحسين للثقة وللعثور عليك.

## 4. مسودتا المنشور
**English:** Athar: one token for every day of the calendar (1950–2049) on TON. Find your date, make it yours, and the token remembers everyone who owned it and matures the longer it is held. Season 1 is open: every day of 2000–2007 plus 78 historic dates. https://t.me/AtharDaysBot

**العربية:** أثر: رمز واحد لكل يوم في التقويم (1950–2049) على شبكة TON. اختر تاريخك فيصير لك، والرمز يتذكّر كل من امتلكه وينضج كلما طال احتفاظ صاحبه به. الموسم الأول مفتوح: كل أيام 2000–2007 و78 تاريخاً تاريخياً. https://t.me/AtharDaysBot

## 5. المصادر
- [شروط توثيق Getgems](https://getgems.helpscoutdocs.com/article/91-verify-my-collection) · [القائمة الرئيسية](https://getgems.helpscoutdocs.com/article/26-how-to-list-my-collection-on-the-main-page) · [Top Collections](https://getgems.helpscoutdocs.com/article/94-top-collections)
- [توثيق Tonkeeper للرموز والمجموعات](https://tonkeeper.helpscoutdocs.com/article/127-tokennftverification) · [ton-assets](https://github.com/tonkeeper/ton-assets)
- [بيانات NFT في TON](https://docs.ton.org/standard/tokens/nft/metadata)
