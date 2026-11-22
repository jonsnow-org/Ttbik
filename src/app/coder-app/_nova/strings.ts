// Strings for the Nova AI redesign (Arabic + English). Shared words come from ../i18n.ts (STR); only the new screens' words live here.

const ar = {
  navHome: "الرئيسية", navChats: "المحادثات", navSchedules: "الجدولة", navSettings: "الإعدادات",
  hi: "أهلاً، {name}!", welcome: "أهلاً بك", getPro: "احصل على Pro", ownerChip: "المالك", pressureTitle: "وضع الضغط", pressureDesc: "عند التفعيل: وسائط أصغر، حدود أقل للخطة المجانية، وطابور ظاهر مع الترتيب، وخوادم التحويل أولاً.", pressureOn: "مفعّل", pressureOff: "متوقف", unlimitedOwner: "غير محدود",
  yourPlan: "خطتك", usedPct: "{p}٪ مستخدم هذا الأسبوع", topUp: "شحن", 
  runningNow: "يعمل الآن", stopAll: "إيقاف الكل", highlights: "أبرز الميزات",
  h_ask: "اسأل {m}", h_askSub: "ارجع إلى الدردشة واكتب طلبك", h_gh: "اربط GitHub", h_ghSub: "ليعمل {m} على مستودعاتك", h_repo: "المستودع", h_repoSub: "المستودع الافتراضي لمهامك",
  h_sched: "جدولة مهمة", h_schedSub: "مهمة تتكرر أو تعمل عند حدث في مستودعك",
  h_mem: "ماذا يتذكر {m}", h_memSub: "تفضيلاتك وقراراتك وحقائق مشاريعك",
  tools: "الأدوات", toolsSub: "اربط خدماتك ليعمل عليها {m}", showAll: "عرض الكل", cat_dev: "تطوير", cat_prod: "إنتاجية",
  can: "ما يقدر عليه نوفا", 
  
  
  ch_search: "ابحث في المحادثات", ch_select: "تحديد", ch_done: "تم", ch_delSel: "حذف المحدد", ch_selected: "محدد", ch_manage: "تنظيف القائمة", ch_delArch: "حذف المؤرشفة / المنتهية", ch_delOld: "حذف الأقدم من 30 يوماً", ch_delAll: "حذف الكل (عدا المثبّتة والحالية)", ch_pin: "تثبيت", ch_unpin: "إلغاء التثبيت", ch_archive: "أرشفة", ch_unarchive: "إلغاء الأرشفة", ch_archived: "المؤرشفة", ch_active: "النشطة", ch_cont: "تابع هذه المحادثة", ch_contHint: "ترسل رسالتك التالية في البوت فتكمل من حيث توقفت، بكامل السجل.", ch_noMatch: "لا توجد محادثات مطابقة", ch_sure: "هل أنت متأكد؟ لا يمكن التراجع.", ch_pinned: "مثبّتة",
  m_title: "الذاكرة والحفظ", m_remember: "تذكّر ما أقوله", m_rememberSub: "يتعلّم معلومات ثابتة عني من المحادثات", m_recall: "استخدم ما تتذكّره", m_recallSub: "يستفيد مما تعلّمه عني في إجاباته", m_save: "احفظ المحادثات", m_saveSub: "تبقى المحادثة في قائمة محادثاتي بعد الانتهاء", m_known: "ما تعرفه عني", m_forget: "انسَ ما تعلّمته عني", m_forgetQ: "سيُنسى الاسم والمدينة وغيرها، وتبقى المحادثات.", m_none: "لا شيء بعد",
  chatsTitle: "المحادثات", startChat: "ابدأ محادثة جديدة", goChat: "اذهب إلى الدردشة", messages: "رسالة", tasksFallback: "سجل الطلبات",
  schedTitle: "الجدولة", paused: "متوقفة", nextRun: "التالي",
  g_profile: "الملف", g_app: "التطبيق", g_owner: "المالك",
  s_think: "التفكير", pol_adaptive: "تلقائي (موصى به)", pol_adaptiveSub: "يفكر في بداية الكود والمهام الطويلة وGitHub حيث يفيد، ولا يفكر في التحية والوسائط ولا في كل خطوة أداة", pol_always: "دائماً", pol_alwaysSub: "يفكر في كل خطوة من كل طلب (ما عدا التحية والوسائط): أدق وأبطأ", pol_never: "بدون تفكير", pol_neverSub: "لا يفكر أبداً: أسرع، وقد يخطئ في اختيار الأدوات", s_force: "فرض وضع للجميع", s_forceSub: "المالك فقط: يتجاوز اختيار المستخدمين لهذا النموذج", force_none: "بلا فرض", force_noneSub: "كل مستخدم بوضعه واختياره التلقائي", s_forModel: "إعدادات النموذج", s_acc: "الدقة", s_policy: "سياسة التأكيد", s_mem: "ما يتذكره {m}", s_plan: "خطتي", s_github: "GitHub",
  s_model: "النموذج", s_lang: "اللغة", s_theme: "المظهر", s_tz: "المنطقة الزمنية", s_home: "أضف إلى الشاشة الرئيسية", s_bio: "قفل بالبصمة", s_status: "حالة الخدمة",
  s_panel: "لوحة التحكم", s_pricing: "التسعير", notLinked: "غير مربوط", free: "مجاني",
  th_auto: "تلقائي", th_autoSub: "يتبع تيليجرام: الداكن ← أسود فضاء", th_light: "فاتح", th_lightSub: "ألوان فضاء على خلفية فاتحة", th_black: "أسود (فضاء)", th_blackSub: "ألوان فضاء الأصلية",
  th_oled: "أسود عميق", th_oledSub: "أسود كامل لشاشات OLED",
  modelPick: "اختر النموذج", hidden: "مخفي", pro: "PRO", selected: "مختار",
  plansTitle: "الخطط", per30: "{d} يوم", choose: "اختر", current: "الحالية", tokensWeek: "رموز أسبوعياً",
};
const en: typeof ar = {
  navHome: "Home", navChats: "Chats", navSchedules: "Schedules", navSettings: "Settings",
  hi: "Hi, {name}!", welcome: "Welcome", getPro: "Get Pro", ownerChip: "Owner", pressureTitle: "Pressure mode", pressureDesc: "When on: smaller media, lower free-plan limits, a visible queue with position, overflow Studios first.", pressureOn: "On", pressureOff: "Off", unlimitedOwner: "Unlimited",
  yourPlan: "Your plan", usedPct: "{p}% used this week", topUp: "Top up", 
  runningNow: "Running now", stopAll: "Stop all", highlights: "Highlights",
  h_ask: "Ask {m}", h_askSub: "Back to the chat to write your request", h_gh: "Connect GitHub", h_ghSub: "So {m} can work on your repos", h_repo: "Repository", h_repoSub: "Default repo for your tasks",
  h_sched: "Schedule a task", h_schedSub: "Repeats, or runs on a repo event",
  h_mem: "What {m} remembers", h_memSub: "Your preferences, decisions and project facts",
  tools: "Tools", toolsSub: "Connect your services so {m} can work on them", showAll: "Show all", cat_dev: "Dev", cat_prod: "Productivity",
  can: "What Nova can do", 
  
  
  ch_search: "Search chats", ch_select: "Select", ch_done: "Done", ch_delSel: "Delete selected", ch_selected: "selected", ch_manage: "Clean up the list", ch_delArch: "Delete archived / finished", ch_delOld: "Delete older than 30 days", ch_delAll: "Delete all (except pinned and the open one)", ch_pin: "Pin", ch_unpin: "Unpin", ch_archive: "Archive", ch_unarchive: "Unarchive", ch_archived: "Archived", ch_active: "Active", ch_cont: "Continue this chat", ch_contHint: "Send your next message in the bot and it carries on from here, with the full history.", ch_noMatch: "No matching chats", ch_sure: "Are you sure? This cannot be undone.", ch_pinned: "Pinned",
  m_title: "Memory & saving", m_remember: "Remember what I say", m_rememberSub: "Learns lasting facts about me from chats", m_recall: "Use what it remembers", m_recallSub: "Uses what it learned about me in its answers", m_save: "Save conversations", m_saveSub: "A chat stays in my chat list after it ends", m_known: "What it knows about me", m_forget: "Forget what it learned about me", m_forgetQ: "Name, city and the rest are forgotten; the chats stay.", m_none: "Nothing yet",
  chatsTitle: "Chats", startChat: "Start a new chat", goChat: "Go to the chat", messages: "messages", tasksFallback: "Request history",
  schedTitle: "Schedules", paused: "Paused", nextRun: "Next",
  g_profile: "Profile", g_app: "App", g_owner: "Owner",
  s_think: "Thinking", pol_adaptive: "Adaptive (recommended)", pol_adaptiveSub: "Thinks at the start of code, long tasks and GitHub where it helps; not for greetings, media or every tool step", pol_always: "Always", pol_alwaysSub: "Thinks at every step of every request (except greetings and media): more accurate, slower", pol_never: "Never", pol_neverSub: "Never thinks: faster, may pick the wrong tool", s_force: "Force a mode for everyone", s_forceSub: "Owner only: overrides every user's choice for this model", force_none: "No override", force_noneSub: "Each user keeps their own mode and Auto", s_forModel: "Model settings", s_acc: "Accuracy", s_policy: "Confirmation policy", s_mem: "What {m} remembers", s_plan: "My plan", s_github: "GitHub",
  s_model: "Model", s_lang: "Language", s_theme: "Theme", s_tz: "Time zone", s_home: "Add to home screen", s_bio: "Biometric lock", s_status: "Service status",
  s_panel: "Control panel", s_pricing: "Pricing", notLinked: "Not linked", free: "Free",
  th_auto: "Auto", th_autoSub: "Follows Telegram: dark → Fadaa black", th_light: "Light", th_lightSub: "Fadaa colours on a light background", th_black: "Black (Fadaa)", th_blackSub: "Fadaa's original colours",
  th_oled: "Deep black", th_oledSub: "True black for OLED screens",
  modelPick: "Choose a model", hidden: "Hidden", pro: "PRO", selected: "Selected",
  plansTitle: "Plans", per30: "{d} days", choose: "Choose", current: "Current", tokensWeek: "tokens / week",
};
export const NSTR = { ar, en };
export type NStr = typeof ar;
export const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ""));
