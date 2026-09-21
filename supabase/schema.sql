-- ============================================================================
-- SouqTools (سوق تولز) Marketplace — Supabase SQL Schema
-- Free-tier Postgres (Supabase). Run this once in the SQL editor of your
-- Supabase project (Project → SQL Editor → New query → paste → Run).
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- categories: the storefront sections (أقسام)
-- ---------------------------------------------------------------------------
create table if not exists categories (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  name_ar     text not null,
  name_en     text,
  description_ar text,
  icon        text default '🧩',
  sort_order  int default 0,
  created_at  timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- services: individual sellable micro-services / templates / bots
-- demo_type drives which interactive component renders on the service page
-- delivery_type/content: what the customer receives automatically on approval
-- ---------------------------------------------------------------------------
create table if not exists services (
  id                uuid primary key default gen_random_uuid(),
  category_id       uuid references categories(id) on delete cascade,
  slug              text unique not null,
  name_ar           text not null,
  name_en           text,
  subcategory       text, -- optional grouping label shown as a sub-heading within the category
  short_desc_ar     text,
  long_desc_ar      text,
  price_usd         numeric(10,2) not null default 0,
  demo_type         text not null check (demo_type in ('ai_chat','bot_simulator','landing_builder','content_ai','catalog_builder','ad_slot_preview','studio_tool')),
  delivery_type     text not null default 'text' check (delivery_type in ('link','text')),
  delivery_content  text, -- e.g. GitHub repo link, license key, Notion guide link
  tool_route        text, -- for demo_type in ('ai_chat','content_ai'): unlocks /tools/<tool_route>?order=<code> on approval
  is_active         boolean default true,
  sort_order        int default 0,
  created_at        timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- customers: light-weight, created on first order (no auth required)
-- ---------------------------------------------------------------------------
create table if not exists customers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  contact     text not null, -- telegram username / email / phone
  created_at  timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- orders: one row per purchase attempt
-- ---------------------------------------------------------------------------
create table if not exists orders (
  id                  uuid primary key default gen_random_uuid(),
  order_code          text unique not null,
  service_id          uuid references services(id) on delete restrict,
  customer_id         uuid references customers(id) on delete set null,
  customer_name       text not null,
  customer_contact    text not null,
  payment_method      text not null check (payment_method in ('bank','usdt')),
  transfer_reference  text not null, -- اسم المُحوِّل / رقم العملية
  amount_usd          numeric(10,2) not null,
  status              text not null default 'pending' check (status in ('pending','approved','rejected')),
  delivery_content    text, -- filled automatically (or overridden by admin) on approval
  admin_note          text,
  telegram_chat_id    text,
  telegram_message_id text,
  created_at          timestamptz default now(),
  decided_at          timestamptz
);

create index if not exists idx_orders_status on orders(status);
create index if not exists idx_orders_code on orders(order_code);

-- ---------------------------------------------------------------------------
-- notifications: in-site notification log (alternative to Telegram)
-- ---------------------------------------------------------------------------
create table if not exists notifications (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid references orders(id) on delete cascade,
  channel     text not null default 'site' check (channel in ('site','telegram')),
  message     text not null,
  is_read     boolean default false,
  created_at  timestamptz default now()
);

-- ============================================================================
-- Row Level Security
-- Public (anon key) may: read active services/categories, create an order,
-- and read the status of ONE order by its order_code (used by the tracking
-- page). Everything else (admin dashboard, approve/reject) uses the
-- SUPABASE_SERVICE_ROLE_KEY from server-side code only, which bypasses RLS.
-- ============================================================================

alter table categories enable row level security;
alter table services enable row level security;
alter table customers enable row level security;
alter table orders enable row level security;
alter table notifications enable row level security;

create policy "public read categories" on categories
  for select using (true);

create policy "public read active services" on services
  for select using (is_active = true);

create policy "public can create customer" on customers
  for insert with check (true);

create policy "public can create order" on orders
  for insert with check (status = 'pending');

-- No public SELECT policy on orders: the table holds customer PII (name,
-- contact, transfer reference), so it must never be readable directly via
-- the anon key/PostgREST. Order tracking instead goes through the narrow,
-- security-definer function below, which returns only non-sensitive columns
-- for a single order_code at a time.

-- notifications and customer/order updates are admin-only (service role),
-- so no additional policies are added for them (default deny).

create or replace function get_order_public_status(p_order_code text)
returns table (
  order_code text,
  status text,
  amount_usd numeric,
  service_name text,
  delivery_type text,
  delivery_content text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    o.order_code,
    o.status,
    o.amount_usd,
    s.name_ar as service_name,
    s.delivery_type,
    case when o.status = 'approved' then o.delivery_content else null end as delivery_content,
    o.created_at
  from orders o
  join services s on s.id = o.service_id
  where o.order_code = p_order_code
  limit 1;
$$;

revoke all on function get_order_public_status(text) from public;
grant execute on function get_order_public_status(text) to anon, authenticated;

-- ============================================================================
-- Base table privileges
-- RLS policies alone are not enough: Postgres also requires the anon/
-- authenticated roles to hold the underlying GRANT on each table, which
-- Supabase normally adds automatically for new tables UNLESS "Automatically
-- expose new tables" was disabled when the project was created (the more
-- secure default). These grants make the RLS policies above actually
-- reachable; RLS still restricts which *rows* are visible.
-- ============================================================================

grant usage on schema public to anon, authenticated;
grant select on public.categories to anon, authenticated;
grant select on public.services to anon, authenticated;
grant insert on public.customers to anon, authenticated;
grant insert on public.orders to anon, authenticated;

-- ============================================================================
-- Seed data — 4 free-to-run categories, ~3 services each
-- ============================================================================

insert into categories (slug, name_ar, name_en, description_ar, icon, sort_order) values
  ('telegram-bots', 'بوتات تليجرام', 'Telegram Bots', 'بوتات جاهزة للتشغيل الفوري لأتمتة الردود وإدارة الطلبات على تليجرام.', '🤖', 1),
  ('ai-translation', 'الترجمة والذكاء الاصطناعي', 'AI & Translation', 'أدوات نصية ذكية بالذكاء الاصطناعي: ترجمة مستندات، تحليل تقارير، ردود آلية.', '🌐', 2),
  ('automation-sites', 'الأتمتة والمواقع', 'Automation & Sites', 'قوالب مواقع وسكربتات أتمتة جاهزة للتشغيل الفوري.', '⚙️', 3),
  ('content-design', 'المحتوى والتصميم بالذكاء الاصطناعي', 'AI Content', 'كتابة محتوى تسويقي، أوصاف منتجات، ومنشورات سوشيال ميديا بالذكاء الاصطناعي.', '🎨', 4),
  ('creative-studio', 'أدوات إبداعية مبتكرة', 'Creative Studio', 'أدوات حقيقية ونادرة تعمل بالكامل داخل متصفحك — لا تجدها بسهولة في أي مكان آخر.', '🎬', 5)
on conflict (slug) do nothing;

insert into services (category_id, slug, name_ar, short_desc_ar, long_desc_ar, price_usd, demo_type, delivery_type, delivery_content, tool_route, sort_order)
select c.id, s.slug, s.name_ar, s.short_desc_ar, s.long_desc_ar, s.price_usd, s.demo_type, s.delivery_type, s.delivery_content, s.tool_route, s.sort_order
from (values
  ('creative-studio', 'audio-visualizer', 'استوديو تحويل الصوت إلى فيديو ريلز',
    'حوّل أي مقطع صوتي إلى فيديو عمودي 9:16 بموجات صوتية متحركة، جاهز للنشر على TikTok وInstagram Reels خلال ثوانٍ.',
    'أداة حقيقية تعمل بالكامل داخل متصفحك عبر Web Audio API وCanvas وMediaRecorder — بدون رفع ملفاتك لأي خادم. ارفع الصوت وصورة غلاف اختيارية ونصاً، واحصل على فيديو WebM جاهز للنشر فوراً.',
    12, 'studio_tool', 'link', null, 'audio-visualizer', 1)
) as s(cat_slug, slug, name_ar, short_desc_ar, long_desc_ar, price_usd, demo_type, delivery_type, delivery_content, tool_route, sort_order)
join categories c on c.slug = s.cat_slug
on conflict (slug) do nothing;

insert into services (category_id, slug, name_ar, subcategory, short_desc_ar, long_desc_ar, price_usd, demo_type, delivery_type, delivery_content, tool_route, sort_order)
select c.id, s.slug, s.name_ar, s.subcategory, s.short_desc_ar, s.long_desc_ar, s.price_usd, s.demo_type, s.delivery_type, s.delivery_content, s.tool_route, s.sort_order
from (values
  ('telegram-bots', 'auto-reply-bot', 'بوت الرد الآلي', 'الرد والدعم', 'بوت تليجرام يرد تلقائياً على استفسارات عملائك على مدار الساعة.',
    'كود جاهز (Node.js) لبوت رد آلي احترافي، يدعم كلمات مفتاحية وردود مخصصة وقوائم أزرار، وقابل للتشغيل الفوري على أي استضافة سحابية.',
    7, 'bot_simulator', 'link', 'https://github.com/jonsnowx1r-lab/Ttbik/tree/main/templates/auto-reply-bot', null, 1),
  ('telegram-bots', 'faq-bot', 'بوت الأسئلة الشائعة', 'الرد والدعم', 'بوت يجيب تلقائياً على الأسئلة المتكررة لعملائك من قائمة تجهزها أنت.',
    'يقرأ قائمة أسئلة/أجوبة من ملف JSON بسيط ويجيب فوراً دون أي تدخل بشري.',
    5, 'bot_simulator', 'link', 'https://github.com/jonsnowx1r-lab/Ttbik/tree/main/templates/faq-bot', null, 2),
  ('telegram-bots', 'order-manager-bot', 'بوت إدارة الطلبات', 'الإدارة والطلبات', 'بوت لاستقبال طلبات العملاء والموافقة عليها بضغطة زر، بنفس فكرة هذه المنصة.',
    'نسخة مصغرة وقابلة لإعادة الاستخدام من نظام الطلبات في هذه المنصة نفسها: استقبال طلب، إشعار فوري، أزرار موافقة/رفض.',
    15, 'bot_simulator', 'link', 'https://github.com/jonsnowx1r-lab/Ttbik/tree/main/templates/order-manager-bot', null, 3),
  ('telegram-bots', 'ad-slot-bot', 'بوت بيع المساحات الإعلانية', 'الإعلانات والتسويق', 'بوت جاهز يبيع مساحات إعلانية في قناتك بنظام رصيد مسبق الدفع، آمن وبدون سحب أموال حقيقي.',
    'كود جاهز (Node.js): العميل يشتري رصيداً إعلانياً، يرسل نص إعلانه، أنت توافق بضغطة زر، والبوت ينشره وينشر النتائج بنفسه. نظام رصيد وليس محفظة إيداع/سحب حقيقية — تجنّباً للمخاطر القانونية والتشابه مع عمليات النصب المنتشرة في بوتات الإعلانات.',
    18, 'ad_slot_preview', 'link', 'https://github.com/jonsnowx1r-lab/Ttbik/tree/main/templates/ad-slot-bot', null, 4)
  -- 'channel-ad-slot' ("أعلن في قناتنا" -- advertise to our own channel's
  -- subscribers) removed for good (owner directive, 2026-09-20): the
  -- channel has no real audience to sell exposure to (a handful of
  -- subscribers), so the promise itself was false. It had been
  -- deactivated once, then mistakenly reactivated in
  -- migration_catalog_cleanup_2026_09_03.sql on the reasoning that it was
  -- "a real deliverable" -- true that the ad WOULD get posted, but
  -- irrelevant if posting it reaches no one. Do not re-add.
) as s(cat_slug, slug, name_ar, subcategory, short_desc_ar, long_desc_ar, price_usd, demo_type, delivery_type, delivery_content, tool_route, sort_order)
join categories c on c.slug = s.cat_slug
on conflict (slug) do nothing;

insert into services (category_id, slug, name_ar, short_desc_ar, long_desc_ar, price_usd, demo_type, delivery_type, delivery_content, tool_route, sort_order)
select c.id, s.slug, s.name_ar, s.short_desc_ar, s.long_desc_ar, s.price_usd, s.demo_type, s.delivery_type, s.delivery_content, s.tool_route, s.sort_order
from (values
  ('ai-translation', 'smart-translator', 'مترجم المستندات التجارية', 'ترجمة عقود وفواتير ورسائل عمل مع الحفاظ الكامل على التنسيق والمصطلحات الرسمية.',
    'أداة ترجمة متخصصة بالمستندات التجارية مدعومة بأحدث نماذج الذكاء الاصطناعي، تحافظ على بنية النص (فقرات، أرقام، بنود) بدل ترجمة حرفية عامة. النسخة الكاملة بدون حد للأحرف.',
    5, 'ai_chat', 'link', null, 'translate', 1),
  ('ai-translation', 'text-summarizer', 'محلل التقارير والمستندات', 'حوّل أي تقرير طويل إلى أهم نقاطه + توصية عملية واحدة جاهزة للتنفيذ.',
    'مصمم لمديري الأعمال: لا يُخرج ملخصاً عاماً، بل نقاطاً رئيسية وتوصية محددة يمكن اتخاذ قرار بناءً عليها فوراً. النسخة الكاملة بدون حد للأحرف.',
    6, 'ai_chat', 'link', null, 'summarize', 2),
  ('ai-translation', 'ai-chat-assistant', 'مساعد ذكي للرد على العملاء', 'مساعد محادثة ذكي يجيب على استفسارات عملائك بالعربية.',
    'صفحة أداة كاملة الوصول بدون حد للأحرف، يمكن مشاركة رابطها مع فريق الدعم لديك.',
    10, 'ai_chat', 'link', null, 'assistant', 3),
  ('ai-translation', 'review-analyzer', 'محلل آراء العملاء بالجملة', 'الصق عشرات تقييمات عملائك دفعة واحدة، واحصل فوراً على تصنيف كل رأي + رد جاهز بالعربية.',
    'يوفر ساعات من القراءة والرد اليدوي على المراجعات: يحلل كل رأي على حدة (إيجابي/سلبي/محايد) ويقترح رداً مناسباً لكل واحد، بدل الاكتفاء بملخص عام. النسخة الكاملة بدون حد للأحرف.',
    9, 'content_ai', 'link', null, 'review-analyzer', 4)
) as s(cat_slug, slug, name_ar, short_desc_ar, long_desc_ar, price_usd, demo_type, delivery_type, delivery_content, tool_route, sort_order)
join categories c on c.slug = s.cat_slug
on conflict (slug) do nothing;

insert into services (category_id, slug, name_ar, short_desc_ar, long_desc_ar, price_usd, demo_type, delivery_type, delivery_content, tool_route, sort_order)
select c.id, s.slug, s.name_ar, s.short_desc_ar, s.long_desc_ar, s.price_usd, s.demo_type, s.delivery_type, s.delivery_content, s.tool_route, s.sort_order
from (values
  ('automation-sites', 'landing-page-generator', 'منشئ صفحات الهبوط', 'أنشئ صفحة هبوط احترافية لمشروعك خلال دقائق بدون كتابة كود.',
    'قالب HTML/CSS/JS احترافي جاهز للنشر الفوري، يتيح تغيير النصوص والألوان والشعار من مكان واحد.',
    12, 'landing_builder', 'link', 'https://github.com/jonsnowx1r-lab/Ttbik/tree/main/templates/landing-page-template', null, 1),
  ('automation-sites', 'workflow-templates', 'قوالب أتمتة جاهزة', 'بديل عملي لأدوات مثل Zapier: قوالب أتمتة جاهزة توفر وقتك وجهدك.',
    'مجموعة سيناريوهات أتمتة موثّقة وجاهزة للتطبيق الفوري (Google Apps Script + Webhooks).',
    9, 'landing_builder', 'link', 'https://github.com/jonsnowx1r-lab/Ttbik/tree/main/templates/automation-recipes', null, 2),
  ('automation-sites', 'invoice-generator', 'مولد الفواتير التلقائي', 'أداة تنشئ فواتير PDF احترافية لعملائك تلقائياً.',
    'يعمل بالكامل داخل المتصفح مباشرة، بسرعة وخصوصية تامة دون رفع بياناتك لأي سيرفر خارجي.',
    6, 'landing_builder', 'link', 'https://github.com/jonsnowx1r-lab/Ttbik/tree/main/templates/invoice-generator', null, 3),
  ('automation-sites', 'whatsapp-catalog', 'كتالوج واتساب لمنتجاتك', 'حوّل منتجاتك من صور متفرقة على حالة واتساب إلى صفحة كتالوج منظمة بزر طلب مباشر.',
    'مصمم خصيصاً لأسلوب البيع السائد في السوق العربي عبر واتساب: كل منتج له زر يفتح محادثة واتساب جاهزة برسالة تحتوي اسم المنتج وسعره تلقائياً.',
    10, 'catalog_builder', 'link', 'https://github.com/jonsnowx1r-lab/Ttbik/tree/main/templates/whatsapp-catalog', null, 4)
) as s(cat_slug, slug, name_ar, short_desc_ar, long_desc_ar, price_usd, demo_type, delivery_type, delivery_content, tool_route, sort_order)
join categories c on c.slug = s.cat_slug
on conflict (slug) do nothing;

insert into services (category_id, slug, name_ar, short_desc_ar, long_desc_ar, price_usd, demo_type, delivery_type, delivery_content, tool_route, sort_order)
select c.id, s.slug, s.name_ar, s.short_desc_ar, s.long_desc_ar, s.price_usd, s.demo_type, s.delivery_type, s.delivery_content, s.tool_route, s.sort_order
from (values
  ('content-design', 'social-caption-generator', 'مولد منشورات السوشيال ميديا', 'اكتب منشورات جذابة لإنستغرام وتيك توك وتويتر خلال ثوانٍ.',
    'أداة تولّد نصوص منشورات بأساليب متعددة (مرح، احترافي، تسويقي) بالذكاء الاصطناعي. النسخة الكاملة بدون حد للأحرف.',
    3, 'content_ai', 'link', null, 'caption', 1),
  ('content-design', 'blog-writer', 'كاتب المقالات الآلي', 'اكتب مسودة مقال متكامل بالعنوان والمقدمة والفقرات من كلمة مفتاحية واحدة.',
    'يوفر ساعات من الكتابة اليدوية، ويصلح كنقطة بداية لمقالات SEO. النسخة الكاملة بدون حد للأحرف.',
    8, 'content_ai', 'link', null, 'blog', 2),
  ('content-design', 'product-description-writer', 'كاتب أوصاف المنتجات', 'أوصاف منتجات مقنعة لمتجرك الإلكتروني خلال ثوانٍ.',
    'مثالي لأصحاب متاجر Shopify/Salla الذين يحتاجون أوصاف منتجات بكميات كبيرة. النسخة الكاملة بدون حد للأحرف.',
    5, 'content_ai', 'link', null, 'product-desc', 3)
) as s(cat_slug, slug, name_ar, short_desc_ar, long_desc_ar, price_usd, demo_type, delivery_type, delivery_content, tool_route, sort_order)
join categories c on c.slug = s.cat_slug
on conflict (slug) do nothing;

-- ============================================================================
-- "متجر" (affiliate products store) -- owner directive 2026-09-21.
-- Separate from `services` on purpose: these are external affiliate-network
-- products (image + description + an outbound affiliate link), not our own
-- deliverable services. Grants written explicitly for service_role from the
-- start -- see migration_store_products.sql for why (a real bug on
-- `services` today: service_role does NOT automatically get table grants
-- in this project, only the RLS-bypass role attribute).
-- ============================================================================

create table if not exists store_products (
  id uuid primary key default gen_random_uuid(),
  title_ar text not null,
  description_ar text,
  image_url text,
  affiliate_url text not null,
  category text not null default 'عام',
  price_display text,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table store_products enable row level security;

create policy "public read active store_products" on store_products
  for select using (is_active = true);

grant select on public.store_products to anon, authenticated;
grant select, insert, update, delete on public.store_products to service_role;
