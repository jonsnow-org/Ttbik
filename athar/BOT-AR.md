# بوت أثر في تيليجرام: القيم الجاهزة (بالإنكليزية أولاً)

البوت يستقبل **الجميع بالإنكليزية** مهما كانت لغة تيليجرام عندهم، وفيه زر «🌐 Language» لتغيير اللغة بين: English، العربية، Русский، Türkçe، فارسی (يُحفظ الاختيار لكل شخص ويُمرَّر إلى التطبيق المصغر). رسالة «Start» وأزرار القائمة في الكود (`src/lib/atharBotLogic.ts`) ولا تُوضع في BotFather.

| الأمر في BotFather | القيمة |
|---|---|
| `/newbot` (الاسم) | `Athar` |
| `/newbot` (اسم المستخدم، ينتهي بـ bot) | `AtharDaysBot` (بدائل: `athar_days_bot` أو `AtharGramBot`) |
| `/setabouttext` (حتى 120 حرفاً) | `One token for every day of the calendar (1950–2049) on TON: alive, matures with time, remembers its owners.` |
| `/setdescription` (حتى 512 حرفاً) | انظر أدناه |
| `/setuserpic` | الصورة: `https://ttbik.vercel.app/athar-bot-avatar.png` (نزّلها وارفعها). بلا أي نص عربي |
| `/setcommands` | `start - Start`  ثم سطر ثانٍ `language - Language` |

**الوصف (`/setdescription`):**
```
🕰 Athar: one token for every day of the calendar (1950–2049).
Pick your birthday, your wedding or a day you love and make it yours alone.
✨ A living token that flashes and turns, and matures the longer you hold it.
📜 It counts its owners and remembers what is engraved on it. Put your own picture on it, or gift it.
🔨 Legendary and historic dates are auctioned; mystery boxes hold surprises.
On the TON network, paid in Gram.
```

## التفعيل
1. افتح صفحة الإدارة `/admin-tools/athar-bot` على الموقع الرئيسي والصق توكن البوت هناك (لا ترسله لأحد).
2. أرسل `/start` للبوت لتجربة الرسالة، وجرّب زر «🌐 Language».
3. ضع في Vercel المتغير `NEXT_PUBLIC_ATHAR_BOT_URL` = `https://t.me/<اسم_البوت>` ثم أعد النشر، فيظهر زر «بوت تيليجرام» في بطاقة أثر على الصفحة الرئيسية.
