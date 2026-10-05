# متغيرات البيئة اللازمة لإعادة بناء كل شيء (الأسماء فقط)

القيم السرية لا تُكتب في المستودع. احفظها عندك في مدير كلمات سر.
قيم Vercel يحتفظ بها Vercel وحده: صدّرها من Settings ← Environment Variables ← Export، أو بالأمر `vercel env pull`، واحفظ الملف عندك.
قيم Oracle في ملفاتها (`media.env` و`backup.env` و`.env` تحت مجلد الإعدادات على الخادم).

## الموقع الرئيسي (Vercel) وبوتات المنصة
`NEXT_PUBLIC_SITE_URL` · `NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_ANON_KEY` · `SUPABASE_SERVICE_ROLE_KEY` · `DATABASE_URL`
`CRON_SECRET` · `SUPER_ADMIN_TELEGRAM_ID` · `ADMIN_PASSWORD` · `RATE_LIMIT_SALT`
`TELEGRAM_BOT_TOKEN` · `TELEGRAM_ADMIN_CHAT_ID` · `TELEGRAM_CHANNEL_ID` · `TELEGRAM_WEBHOOK_SECRET` · `VERCEL_WEBHOOK_SECRET`
`PROMO_AD_BOT_USERNAME` · `NEXT_PUBLIC_OWNER_ID` · `OWNER_ID`
`GROQ_API_KEY` · `GOOGLE_SAFE_BROWSING_API_KEY`
`NOVA_FASTAPI_URL` · `NOVA_INTERNAL_SECRET` · `NOVA_CREDENTIAL_KEY`
`NEXT_PUBLIC_MONETAG_ZONE_ID` · `NEXT_PUBLIC_MONETAG_BANNER_SCRIPT_URL` · `NEXT_PUBLIC_MONETAG_BANNER_CONTAINER_ID`

## المدفوعات والمحافظ
`NOWPAYMENTS_API_KEY` · `NOWPAYMENTS_IPN_SECRET` · `TON_NETWORK` · `TON_API_KEY` · `MASTER_TON_MNEMONIC` (كلمات المحفظة: لا تُخزَّن إلا عندك) · `MASTER_HOT_WALLET_ADDRESS` · `OWNER_CWALLET_ADDRESS` · `OWNER_SWEEP_THRESHOLD`
`USDT_NETWORK` · `USDT_ADDRESS` · `USDT_JETTON_MASTER_ADDRESS` · `BANK_HOLDER` · `BANK_NAME` · `BANK_ACCOUNT_NUMBER` · `BANK_ROUTING_NUMBER` · `BANK_ADDRESS` · `BANK_ACCOUNT_TYPE`

## بوت الوسائط (Oracle: `media.env`)
`BOT_TOKEN` · `OWNER_ID` · `ARCHIVE_CHANNEL_ID` · `FORCE_SUB_CHANNEL` · `ENABLE_GLOBAL_FEED` · `FEED_API_URL` · `FEED_SECRET` · `YTDLP_COOKIES` · `PROXY_URL` · `COBALT_API_KEY` · `MAX_FILE_BYTES` · `PUBLIC_HOST` · `MAX_CONCURRENT_DOWNLOADS` · `MEDIA_BOT_TOKEN` · `NEXT_PUBLIC_MEDIA_BOT_USERNAME` · `MEDIA_BOT_RENDER_URL` · `NEXT_PUBLIC_MEDIA_STREAM_BASE` · `NEXT_PUBLIC_BASHAR_TG_APP`

## أثر
`ATHAR_ADMIN` · `NEXT_PUBLIC_ATHAR_ADMIN` · `ATHAR_ADMIN_PATH` · `NEXT_PUBLIC_ATHAR_META_BASE` · `ATHAR_PRIMARY` · `ATHAR_NETWORK` · `TONCENTER_API_KEY` (اختياري ومجاني؛ يمكن أيضاً لصقه في لوحة الإدارة فيُحفظ في مجلد البيانات على الخادم `secrets/` ويُستثنى من النسخ الأسبوعي)
كلمات محفظة الإدارة: عند مدير كلمات السر فقط. مفتاح كشف صناديق الغموض: ملف `athar-season1-secret.json` أو السطران اللذان نسختَهما.

## Oracle (`backup.env`)
`DATABASE_URL` · `AUTO_RESTORE`

## حسابات لا يحفظها أي أرشيف
Cloudflare (Worker `athar-meta`) · Supabase · Vercel · Render · Oracle · BotFather (رموز البوتات) · Arweave/Turbo (محفظة الرفع إن وجدت).
