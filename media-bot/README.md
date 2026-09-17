# Media Download Bot — Worker (Render Free)

بوت تحميل وسائط متقدم يعمل على **Render Free** دائماً.

## المبادئ
- مجاني دائماً
- قناة تيليجرام = أرشيف دائم (`file_id` + URL)
- لوحتان منفصلتان داخل البوت:
  - **لوحة مالك البوت** (Owner Panel)
  - **لوحة المستخدم** (User Panel)
- مفتاح الموجز العام من المالك + إعداد خصوصية لكل مستخدم
- قناة اشتراك إجباري قابلة للتعيين

## ما يعمل الآن (Phase 1)
- `/start` → لوحة المالك أو لوحة المستخدم حسب الآيدي
- فحص الاشتراك الإجباري
- استقبال الرابط → عرض العنوان والمدة → أزرار الجودة
- تحميل عبر yt-dlp (360 / 480 / 720 / صوت MP3 / رسالة صوتية)
- كاش `file_id` في الذاكرة + أرشفة صامتة في قناة التخزين
- إرسال من الكاش فوراً عند تكرار نفس الرابط

## المتغيرات المطلوبة على Render
```
BOT_TOKEN=123456:ABC...
OWNER_ID=420066855
ARCHIVE_CHANNEL_ID=-100xxxxxxxxxx
FORCE_SUB_CHANNEL=@YourChannel   # اختياري
ENABLE_GLOBAL_FEED=false
```

## النشر على Render Free
1. New → Web Service
2. اربط مستودع `jonsnow-org/Ttbik`
3. Root Directory: `media-bot`
4. Runtime: Docker
5. ضع المتغيرات أعلاه
6. Deploy

> الخدمة تنام بعد 15 دقيقة خمول. أول طلب بعد النوم يستغرق ~دقيقة (رسالة الإيقاظ الذكية قادمة).

## هيكل الملفات
```
media-bot/
├── main.py
├── config.py
├── keyboards.py
├── services/
│   ├── downloader.py
│   ├── archive.py
│   └── force_sub.py
├── requirements.txt
├── Dockerfile
└── README.md
```
