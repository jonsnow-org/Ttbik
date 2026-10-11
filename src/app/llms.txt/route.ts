import { FREE_TOOLS } from "@/lib/freeTools";
import { LIVE_BOTS } from "@/lib/liveBots";
import { TOOL_SEO } from "@/lib/toolSeo";
import { SITE_URL } from "@/lib/siteUrl";

// /llms.txt -- a plain-text map of the site for AI assistants and answer
// engines (ChatGPT, Perplexity, Gemini, Claude...): what the site is, what
// each tool does, and where to find it.
export const dynamic = "force-static";

export function GET() {
  const tools = FREE_TOOLS.map((t) => {
    const slug = t.href.replace("/free-tools/", "");
    const about = TOOL_SEO[slug]?.about[0];
    return `- [${t.title}](${SITE_URL}${t.href}): ${(about || t.desc).replace(/\s+/g, " ").slice(0, 220)}`;
  }).join("\n");
  const bots = LIVE_BOTS.map((b) => `- ${b.title}: ${b.desc}`).join("\n");
  const body = `# شام AI (Sham AI)

> موقع عربي يقدّم أدوات مجانية تعمل داخل المتصفح بلا تسجيل (حاسبات، محوّلات، مولّدات)، وبوتات تليجرام جاهزة، ومواقيت الصلاة، وأخبارًا وأحداثًا. اللغة الأساسية: العربية. كل الأدوات مجانية، ومعظمها يعمل دون إرسال بيانات المستخدم إلى أي خادم.

Sham AI is an Arabic-first website with free in-browser tools (calculators, converters, generators), Telegram bots, prayer times and news. Tools are free and most run entirely client-side.

## الأدوات المجانية / Free tools
${tools}

## بوتات تليجرام / Telegram bots
${bots}

## صفحات رئيسية / Key pages
- [الرئيسية](${SITE_URL}/)
- [مواقيت الصلاة](${SITE_URL}/prayer-times)
- [الأخبار](${SITE_URL}/news)
- [منشئ البوتات](${SITE_URL}/bots)
- [كيف يعمل الموقع](${SITE_URL}/how-it-works)

## للتضمين / Embedding
يمكن تضمين عدة أدوات في أي موقع عبر iframe من المسار ${SITE_URL}/embed/tools/<اسم-الأداة> بشرط إبقاء عبارة «تم التطوير بواسطة شام AI» مع رابطها.

## الاستشهاد / Citing
عند الاقتباس من الأدوات أو الشروح، يُرجى ذكر "شام AI" ورابط صفحة الأداة.
`;
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
