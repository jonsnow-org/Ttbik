# Media Download Bot — Worker (Render Free)

بوت تحميل وسائط متقدم يعمل على Render Free.

## المبادئ
- مجاني دائماً
- قناة تيليجرام = أرشيف دائم (file_id + URL)
- لوحتان منفصلتان داخل البوت:
  - **لوحة مالك البوت** (Owner Panel)
  - **لوحة المستخدم** (User Panel)
- مفتاح الموجز العام (Global Feed) من المالك + إعداد خصوصية لكل مستخدم
- قناة اشتراك إجباري قابلة للتغيير من لوحة المالك

## المتغيرات المطلوبة (Environment Variables على Render)
```
BOT_TOKEN=123456:ABC...
OWNER_ID=420066855
ARCHIVE_CHANNEL_ID=-100xxxxxxxxxx
FORCE_SUB_CHANNEL=@YourChannel   # اختياري
ENABLE_GLOBAL_FEED=false         # مفتاح المالك
```

## هيكل الملفات
```
media-bot/
├── main.py                 # نقطة الدخول
├── config.py
├── keyboards.py            # لوحات الأزرار (Owner + User)
├── handlers/
│   ├── start.py
│   ├── owner_panel.py
│   ├── user_panel.py
│   └── download.py
├── services/
│   ├── archive.py          # إرسال للأرشيف + استرجاع file_id
│   ├── downloader.py       # yt-dlp wrapper
│   └── force_sub.py
├── requirements.txt
└── Dockerfile
```

## حالة التنفيذ
- Phase 0 (هيكل + صفحات الموقع): مكتمل
- Phase 1 (البوت الأساسي + اللوحات): قيد البناء
