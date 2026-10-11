# إضافة كروم — شام AI

إضافة MV3 خفيفة (بلا مكتبات): نافذة منبثقة بأهم الأدوات، وزر «رمز QR للصفحة الحالية»، وزر «اختصار رابط الصفحة»، وقائمة سياق «رمز QR لهذا الرابط». كل فتح يحمل `utm_source=chrome_extension`.

## تجربتها محليًا
1. افتح `chrome://extensions` وفعّل Developer mode.
2. اضغط «Load unpacked» واختر مجلد `extension/`.

## النشر في Chrome Web Store
1. أنشئ حساب مطوّر (رسم 5$ مرة واحدة): https://chrome.google.com/webstore/devconsole
2. اضغط ملفات المجلد داخل ZIP: `cd extension && zip -r ../sham-ai-extension.zip .`
3. ارفع الـ ZIP وأضف: لقطات شاشة 1280×800، وأيقونة 128، والوصف أدناه، وسياسة خصوصية (الإضافة لا تجمع بيانات؛ تقرأ رابط التبويب النشط فقط عند الضغط وتفتحه في موقعنا).

### وصف المتجر (عربي)
أدوات عربية مجانية بضغطة: أنشئ رمز QR للصفحة التي تتصفحها، اختصر الرابط، واحسب الزكاة وBMI وضريبة القيمة المضافة وحوّل بين الهجري والميلادي وغيرها. بلا تسجيل وبلا تتبع.

### Store description (EN)
Free Arabic-first tools in one click: QR code for the current page, URL shortener, Zakat, BMI, VAT, Hijri converter and more. No sign-up, no tracking.

## الأذونات
- `activeTab`: لقراءة رابط التبويب الحالي عند الضغط فقط.
- `contextMenus`: لعنصر «رمز QR لهذا الرابط».
