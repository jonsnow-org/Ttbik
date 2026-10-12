# شام AI (Sham AI) — بوتات مستضافة + أدوات مجانية + خدمات حقيقية

منصة **شام** (مستودعها التقني: `Ttbik`): بوتات تليجرام **مستضافة لدينا** تعمل بتوكن العميل، أدوات متصفح مجانية، وخدمات رقمية حقيقية — **بدون بيع كود مغلَق أو قوالب كملفات مدفوعة**. تكلفة التشغيل المستهدفة ≈ 0$ (Vercel Hobby + Supabase Free + Groq مجاني حيث يلزم).

> المصدر الحي للقرارات والقواعد: [`docs/AGENT_BUS.md`](./docs/AGENT_BUS.md) ومخطط القاعدة [`prisma/schema.prisma`](./prisma/schema.prisma).  
> ملف `docs/PROJECT_BRIEF_FOR_HANDOFF.md` مؤرشف/قديم — لا تعتمد عليه للتنفيذ.

## ماذا نقدّم (وما لا نقدّم)

| نقدّم | لا نقدّم |
|---|---|
| بوت تليجرام **يعمل فعلياً** على خوادمنا (white-label / multi-tenant) | تسليم سورس كود أو قالب ZIP كمنتج مدفوع |
| أدوات استوديو/حاسبات **مجانية في المتصفح** (`/free-tools` وغيرها) | بيع «وصول» عام لأدوات AI يمكن الحصول عليها مجاناً من أي روبوت محادثة |
| خدمات Done-for-you وطلبات يراجعها المالك عبر `/admin` | كتالوج «اشترِ هذا الملف/الكود» |

التفاصيل والقواعد الثابتة: انظر قسم Product rules في [`docs/AGENT_BUS.md`](./docs/AGENT_BUS.md).

## البنية التقنية (Free tier حيث أمكن)

| الطبقة | الخدمة |
|---|---|
| التطبيق | **Next.js** (App Router) + TypeScript + Tailwind — استضافة **Vercel** |
| قاعدة البيانات | **Supabase** (Postgres) + **Prisma** (`prisma/schema.prisma`) |
| بوتات تليجرام | **grammY** + webhook موحّد `/api/telegram/[botId]` |
| ذكاء اصطناعي (حيث يُستخدم) | **Groq** (مجاني محدود) — و Nova AI عقل منفصل تحت `ai-system/` عند الحاجة |
| لوحة الإدارة | `/admin` (موافقة طلبات، إدارة، إلخ) |

فرع النشر الافتراضي للسوق/المنصة: `claude/free-services-marketplace-h6rwk2` (ليس `main` ولا فروع Athar المنفصلة).

## الأقسام باختصار

1. **🤖 بوتات مستضافة** — تفعيل من `/bots` بتوكن BotFather. القالب العام `AD_BOT`؛ قوالب إضافية للمالك فقط بعد تسجيل `/admin`. لا يُسلَّم كود القالب للعميل.
2. **🧰 أدوات مجانية** — قائمة موحّدة في `src/lib/freeTools.ts` وصفحات تحت `/free-tools` وغيرها (حاسبات، QR، مواقيت، …).
3. **🛒 طلبات وخدمات** — دورة طلب/دفع يدوي أو شبه آلي عبر `/admin` مع تتبع `/order/[code]` حيث ينطبق.
4. **📰 محتوى الموقع** — مدونة/أخبار/أحداث على الصفحة الرئيسية.

## هيكل مهم

```
src/app/bots/                 تفعيل البوتات المستضافة
src/app/api/bots/             deploy / template-ready / health-check …
src/app/api/telegram/[botId]/  مُوزّع الـ webhook حسب القالب
src/lib/*BotLogic.ts          منطق كل قالب
prisma/schema.prisma          مخطط الجداول الحي
prisma/migration_*.sql        سكربتات يشغّلها المالك يدوياً في Supabase SQL Editor
docs/AGENT_BUS.md             قواعد الوكلاء والمنتج (مصدر الحقيقة)
```

## تشغيل محلي (اختياري)

```bash
npm install
cp .env.example .env.local   # عبّئ القيم
npm run dev
```

للإنتاج: اربط المستودع بـ Vercel، أضف متغيرات البيئة من `.env.example` / `docs/ENV-VARS.md`، ونفّذ أي ملفات `prisma/migration_*.sql` الناقصة في Supabase ← SQL Editor (مع `GRANT … TO service_role` كما في الملفات نفسها).

## أمان مختصر

- أسرار البوتات والتوكنات على السيرفر فقط؛ لا تُعرَض قوالب البوتات المدفوعة/الخاصة للتنزيل.
- `/admin` محمي بكلمة مرور وكوكي `httpOnly`.
- Webhooks تليجرام تتحقق عبر `secret_token`.
- بيانات الدفع البنكي/USDT تُدخل كمتغيرات بيئة فقط — لا تُكتب في الكود.

## ملاحظة للمساهمين / الوكلاء

اقرأ [`docs/AGENT_BUS.md`](./docs/AGENT_BUS.md) و[`AGENTS.md`](./AGENTS.md) قبل أي تعديل. لا تلمس `athar/**` أو فروع Athar إلا بمهمة صريحة منفصلة.
