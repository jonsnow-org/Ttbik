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
7. Settings → Build Filters → Included Paths: `media-bot/**` (حتى لا يُعاد البناء مع كل تعديل على الموقع)

## وضع التشغيل: Webhook (لا يُبقي نفسه مستيقظاً)
- على Render يعمل البوت تلقائياً بطريقة webhook (يعتمد على `RENDER_EXTERNAL_URL` الذي يضعه Render). تليجرام يرسل كل رسالة للبوت فيوقظه.
- الخدمة تنام بعد 15 دقيقة بلا استخدام، فلا تستهلك من الـ750 ساعة المجانية إلا وقت الاستخدام الفعلي.
- أول رسالة بعد النوم تتأخر ~30–60 ثانية، ولا تضيع (تليجرام يعيد إرسالها).
- **ممنوع** إضافة أي ping ذاتي أو خدمة مراقبة خارجية تزور الرابط كل بضع دقائق: هذا ما استنفد الرصيد المجاني في سبتمبر 2026.
- محلياً (بلا `RENDER_EXTERNAL_URL`/`WEBHOOK_BASE_URL`) يعمل بطريقة polling العادية.

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
