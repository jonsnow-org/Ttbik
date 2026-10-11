# خطة النمو: صفحات الأدوات، الإضافة، التضمين، الأدلة، GEO

ما تم تنفيذه في الكود (2026-10-11):
- لكل أداة صفحة مستقلة `/free-tools/<tool>` تحتها شرح (~300 كلمة) وخطوات وفوائد وأسئلة شائعة مع JSON-LD (FAQPage + HowTo + WebApplication) وروابط لأدوات أخرى — المصدر: `src/lib/toolSeo.ts` و`src/components/ToolSeoSection.tsx`.
- أداة جديدة تُضاف: أضف مدخلها في `FREE_TOOLS` و`TOOL_SEO` ثم ضع `<ToolSeoSection slug="..."/>` في صفحتها.
- أدوات قابلة للتضمين `/embed/tools/<tool>` (8 أدوات) مع شرط ظهور «تم التطوير بواسطة شام AI» + كود iframe جاهز تحت كل أداة قابلة للتضمين (`src/lib/embedTools.ts`).
- بطاقات مشاركة كصورة (BMI، الزكاة، عدّاد العمر، ستوري) بشعار وعنوان الموقع — `src/components/ShareCard.tsx`.
- `/llms.txt` خريطة نصية للموقع لمحركات الإجابة (ChatGPT/Perplexity/Gemini/Claude).
- إضافة كروم MV3 جاهزة للحزم في `extension/` (انظر `extension/README.md`).

ما لا يمكن تنفيذه من الكود وعليك فعله يدويًا: التسجيل في Chrome Web Store (رسم 5$ لمرة واحدة) والأدلة والمنشورات أدناه.

## 1) الأدلة (انسخ والصق)
الاسم: **Sham AI — شام AI**
الرابط: https://ttbik.vercel.app
شعار قصير (EN): Free Arabic-first online tools: calculators, converters, generators and Telegram bots — no sign-up.
شعار قصير (AR): أدوات عربية مجانية بلا تسجيل: حاسبات ومحوّلات ومولّدات وبوتات تليجرام.
وصف طويل (EN): Sham AI is a free, Arabic-first toolbox that runs in your browser. It includes a Zakat calculator, BMI calculator, Hijri↔Gregorian converter, VAT and profit-margin calculators, QR and WhatsApp-link generators, an image compressor, a URL shortener with click counts, an Arabic CV and invoice generator, plus AI helpers (writing assistant, text and sentiment analyzers, business-name generator). Most tools process data locally in the browser. Tools can be embedded on other sites for free with attribution.
الفئات المقترحة: Productivity, Utilities, Arabic, Writing assistant, Text analysis, Name generator.
المنصات: Product Hunt، Futurepedia، There's An AI For That، FutureTools (اختر أدوات الذكاء الاصطناعي فقط عند تقديمها: مساعد الكتابة، محلل النصوص، محلل المشاعر، مولّد الأسماء).
نصيحة Product Hunt: أطلق الأداة الأقوى وحدها (مثلاً «عدّاد العمر» أو «الزكاة») مع صورة بطاقة المشاركة، وفي صباح يوم الثلاثاء/الأربعاء بتوقيت المحيط الهادئ.

## 2) محتوى GEO (Reddit / Quora / Medium)
اكتب بنبرة تعليمية لا إعلانية، وضع الرابط في آخر المقال كمصدر. مسودات جاهزة:

**أ) Medium/عربي — «كيف تحسب زكاة مالك خطوة بخطوة (مع حاسبة مجانية)»**
النقاط: ما هو النصاب (85 غ ذهب / 595 غ فضة) — نسبة 2.5% — الحول — ما يُخصم من الدين — مثال رقمي — رابط الحاسبة.

**ب) Quora/عربي — «ما الفرق بين هامش الربح ونسبة الإضافة؟»**
مثال: تكلفة 100 وسعر 150 → إضافة 50% وهامش 33.3%. أخطاء التسعير الشائعة. رابط حاسبة الهامش.

**ج) Reddit/English (r/SideProject أو r/InternetIsBeautiful) — «I built a free Arabic toolbox that runs entirely in the browser»**
اشرح الفكرة التقنية (الحساب محلي، لا تسجيل)، اطلب رأيًا، وأرفق رابط الأدوات.

**د) Quora/English — «Is there a free online Zakat calculator with adjustable nisab?»** أجب بشرح قصير ثم رابط.

قاعدة: لا تنشر الرابط نفسه في أكثر من مجتمع واحد في اليوم، واقرأ قواعد كل مجتمع قبل النشر.

## 3) قياس النتائج
- استخدم `utm_source` (سبق إضافته للإضافة والتضمين: `chrome_extension`, `embed`).
- راقب في Search Console: ظهور صفحات `/free-tools/*` وحصولها على عروض FAQ.
