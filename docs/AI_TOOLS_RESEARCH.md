# ما تملكه أقوى نماذج الذكاء اليوم من أدوات، وما نملكه نحن (2026-11-08)

**المصادر** (أغلبها مدونات ثانوية لا وثائق رسمية، فالمقارنة تقريبية؛ تحقق من وثائق كل مزوّد):
[Gemini API tools](https://ai.google.dev/gemini-api/docs/tools) (وثائق رسمية) · [OpenAI Responses API: أدوات مدمجة](https://www.eesel.ai/blog/openai-responses-api) · [AI Agent Tools: Skills, MCP, CLI & Computer Use](https://jannikreinhard.com/2026/05/15/skills-mcp-cli-computer-use-mapping-the-ai-tooling-surface-in-2026/) · [The 2026 AI Agent Stack](https://codingwithroby.substack.com/p/the-2026-ai-agent-stack-drawn-from) · [Blueprint of a Frontier Coding Agent](https://medium.com/@talirezun/blueprint-of-a-frontier-coding-agent-1059730d802a).

## ما يجمع عليه المزوّدون الكبار
| الفئة | عند الكبار | عندنا (شام وشام v2) |
|---|---|---|
| بحث ويب | Google Search / `web_search` | `web_search` ✔ |
| قراءة صفحة | URL context / fetch | `fetch_page`, `http_request` ✔ |
| بحث معمّق | Deep research | `deep_research` ✔ |
| تنفيذ كود | Code execution / code interpreter | `computer_run` + `computer_job` ✔ (حاسوب مدمج في النموذج) |
| ملفات وتعديل | read/write/edit/glob/grep | `computer_read/write/edit/search` ✔ + **`computer_patch`** (جديد: diff متعدد الملفات كله أو لا شيء) |
| اختبار وتحقق | تشغيل الاختبارات | **`computer_test`** (جديد) |
| استخدام الحاسوب/المتصفح | Computer Use | `browser` ✔ مدمج؛ `desktop` ✘ خارج النموذج بعد |
| الذاكرة | memory tool (فهرس + مواضيع + أرشيف) | `memory_save/search` ✔ + **`memory_forget`** (جديد) |
| التخطيط | قائمة مهام (todo) | **`plan`** (جديد) |
| المهارات | Skills: إجراء عند الطلب | **`skill`** (جديد): 11 مهارة (pdf, word, spreadsheet, presentation, chart, scrape, git, debug, research, plan, data) |
| وكلاء فرعيون | sub-agents | `delegate` ✔ |
| موصلات وMCP | MCP / connectors | `connector_api`, `mcp_list_tools`, `mcp_call` ✔ |
| جدولة | scheduled tasks | `schedule_*` ✔ |
| توليد وسائط | image generation | `make_media` ✔ (مولّد النموذج الداخلي) |
| استفسار المستخدم | ask / clarify | `ask_user` ✔ |
| إرسال ملف | file output | `send_file` ✔ |
| بحث ملفات مُدار | File Search (RAG) | `recall` (جزئي) ✘ |
| خرائط | Google Maps | ✘ (يمكن عبر `http_request`/المتصفح) |

## ما أضفته الآن
1. **خمس أدوات** لكلا النموذجين: `plan`, `memory_forget`, `computer_patch`, `computer_test`, `skill`. تنفيذها: داخل حلقة النموذج (الحاسوب) أو في التطبيق (مهارة/خطة/ذاكرة).
2. **التدريب على الاستعمال لا على الاسم فقط:** كل أداة لها أمثلة، وأُضيفت **مسارات عمل** كاملة: (مهارة ← تثبيت ← كتابة ← تشغيل ← إرسال ملف)، (خطة ← عمل ← اختبار ← تحديث الخطة)، (استنساخ ← patch ← اختبار ← قراءة السجل)، (بحث في الذاكرة ← نسيان). و28 صياغة جديدة (عربي/إنجليزي/قصير) لأدوات موجودة، وأمثلة لثماني أدوات `sandbox_*` كانت معروضة ولم تُدرَّب قط.
3. **قياس التغطية:** كل أدوات النموذج (49 الآن) تظهر في بيانات التدريب؛ اختبار `sham_tools_data.py` يفرض تطابق أسماء الأدوات الحية مع بيانات التدريب.

## ما لم أفعله (بصراحة)
- **لم يُدرَّب أي نموذج بعد على هذه البيانات** (لا دفتر شُغّل). معرفة النداء تتحقق بعد التدريب؛ الآن الأدوات معروضة ومنفَّذة وبياناتها جاهزة.
- **`desktop`** (الشاشة الرسومية) خارج النموذج.
- **رؤية الصور/سمع الصوت كأداة** (`view_image`): تحتاج نموذجًا يرى؛ استوديو شام يفهم الوسائط داخليًا لكن جودته ضعيفة قبل التدريب فلم أعرضها كأداة بلا فائدة.
- **File Search وخرائط:** غير مضافة.
- **نوفا:** لديها 80 أداة وفيها `plan` و`computer_patch/test` و`memory_forget`، وينقصها `skill`. لم أضفه لأن الطلب «إن أردت»؛ أضيفه بطلبك.
