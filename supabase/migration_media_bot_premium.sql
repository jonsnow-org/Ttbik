-- Media-bot paid upgrade (owner decision 2026-09-20: "أضف دفع... اذهب نفذها"
-- -- add payment methods/features across bots+site, any method except
-- Telegram Stars). Reuses the site's own existing services/orders/decideOrder
-- purchase-and-manual-approval flow instead of inventing a second payment
-- system. Unlike the now-deleted "hosted-bot-builder" service (which told
-- buyers to redeem their order code on /bots, but /bots/deploy never read
-- the orders table -- see migration_final_cleanup_2026_09_09.sql), this one
-- has a real, working verification endpoint: src/app/api/media-bot/
-- verify-premium/route.ts actually checks the orders table.
-- tool_route is left null on purpose -- decideOrder() would otherwise
-- overwrite delivery_content with a /tools/<tool_route> link on approval,
-- but this service has no /tools page; the customer's real next step is
-- back inside the Telegram bot itself.
insert into services (category_id, slug, name_ar, subcategory, short_desc_ar, long_desc_ar, price_usd, demo_type, delivery_type, delivery_content, tool_route, sort_order)
select id, 'media-bot-premium', 'ترقية بوت الوسائط المدفوعة', 'بوتات تليجرام',
  'ارفع حدك اليومي في بوت تحميل الوسائط وفعّل أولوية أعلى في المعالجة.',
  'بعد الموافقة على طلبك، عد إلى بوت الوسائط على تليجرام وأرسل الأمر: /premium ثم رمز طلبك (مثال: /premium ABC123) لتفعيل الترقية فوراً على حسابك.',
  5, 'bot_simulator', 'text', 'عد إلى بوت الوسائط على تليجرام وأرسل: /premium ثم رمز طلبك لتفعيل الترقية فوراً.', null, 7
from categories where slug = 'telegram-bots'
on conflict (slug) do nothing;

-- Prevents one approved order code from being redeemed by more than one
-- Telegram account (a $5 purchase shared publicly would otherwise unlock
-- premium for everyone) while staying idempotent for the SAME account
-- re-sending /premium after a bot restart wipes its in-memory+archive
-- premium flag. Same "claim once via a nullable column" idempotency shape
-- as NOWPayments' payment_id-based dedup in api/orders/payment-webhook.
alter table orders add column if not exists redeemed_by_tg_id text;
