export type AiToolCategoryId =
  | "writing"
  | "images"
  | "video"
  | "coding"
  | "research"
  | "productivity"
  | "design"
  | "marketing";

export type AiToolCategory = {
  id: AiToolCategoryId;
  icon: string;
  ar: string;
  en: string;
};

export type AiToolItem = {
  id: string;
  name: string;
  category: AiToolCategoryId;
  url: string;
  ar: string;
  en: string;
};

export const AI_TOOL_CATEGORIES: readonly AiToolCategory[] = [
  { id: "writing", icon: "✍️", ar: "الكتابة والمحتوى", en: "Writing & content" },
  { id: "images", icon: "🎨", ar: "توليد الصور", en: "Image generation" },
  { id: "video", icon: "🎬", ar: "الفيديو والصوت", en: "Video & audio" },
  { id: "coding", icon: "💻", ar: "البرمجة وتطوير التطبيقات", en: "Coding & app development" },
  { id: "research", icon: "🔎", ar: "البحث والمصادر", en: "Research & search" },
  { id: "productivity", icon: "⚡", ar: "الإنتاجية والأتمتة", en: "Productivity & automation" },
  { id: "design", icon: "🧩", ar: "التصميم والواجهات", en: "Design & UI" },
  { id: "marketing", icon: "📈", ar: "التسويق وSEO", en: "Marketing & SEO" },
] as const;

// An original, curated selection of external products. Descriptions are written
// for this directory rather than copied from a third-party listing.
export const AI_TOOLS: readonly AiToolItem[] = [
  {
    id: "chatgpt",
    name: "ChatGPT",
    category: "writing",
    url: "https://chatgpt.com/",
    ar: "للمحادثة، صياغة النصوص، التلخيص، العصف الذهني ومهام يومية متعددة.",
    en: "For chat, drafting, summarizing, brainstorming, and a wide range of everyday tasks.",
  },
  {
    id: "claude",
    name: "Claude",
    category: "writing",
    url: "https://claude.ai/",
    ar: "مساعد للكتابة والتحليل والعمل على المستندات والنصوص الطويلة.",
    en: "An assistant for writing, analysis, and working with longer documents and text.",
  },
  {
    id: "grammarly",
    name: "Grammarly",
    category: "writing",
    url: "https://www.grammarly.com/",
    ar: "لمراجعة اللغة الإنجليزية وتحسين الوضوح والنبرة والأسلوب.",
    en: "For English writing feedback, clarity, tone, and style improvements.",
  },
  {
    id: "midjourney",
    name: "Midjourney",
    category: "images",
    url: "https://www.midjourney.com/",
    ar: "لتوليد الصور الفنية والمرئية انطلاقاً من الأوصاف النصية.",
    en: "Creates artistic and visual concepts from text prompts.",
  },
  {
    id: "firefly",
    name: "Adobe Firefly",
    category: "images",
    url: "https://firefly.adobe.com/",
    ar: "لتوليد الصور وتحرير العناصر المرئية ضمن أدوات Adobe الإبداعية.",
    en: "For image generation and visual editing in Adobe's creative ecosystem.",
  },
  {
    id: "ideogram",
    name: "Ideogram",
    category: "images",
    url: "https://ideogram.ai/",
    ar: "لتصميم صور وملصقات ومواد مرئية، مع تركيز على النص داخل الصورة.",
    en: "For visual concepts, posters, and designs with an emphasis on text in images.",
  },
  {
    id: "runway",
    name: "Runway",
    category: "video",
    url: "https://runwayml.com/",
    ar: "أدوات ذكاء اصطناعي لإنشاء الفيديو وتحريره والتجريب البصري.",
    en: "AI tools for video creation, editing, and visual experimentation.",
  },
  {
    id: "elevenlabs",
    name: "ElevenLabs",
    category: "video",
    url: "https://elevenlabs.io/",
    ar: "لتوليد الصوت وتحويل النص إلى كلام وتجارب صوتية متعددة اللغات.",
    en: "For AI voice, text-to-speech, and multilingual audio workflows.",
  },
  {
    id: "suno",
    name: "Suno",
    category: "video",
    url: "https://suno.com/",
    ar: "لتجربة إنشاء أغانٍ ومقاطع موسيقية انطلاقاً من وصف أو فكرة.",
    en: "For experimenting with song and music creation from an idea or prompt.",
  },
  {
    id: "github-copilot",
    name: "GitHub Copilot",
    category: "coding",
    url: "https://github.com/features/copilot",
    ar: "مساعد برمجي لاقتراح الشيفرة وشرحها وتسريع بعض مهام التطوير.",
    en: "A coding assistant for code suggestions, explanations, and development workflows.",
  },
  {
    id: "cursor",
    name: "Cursor",
    category: "coding",
    url: "https://cursor.com/",
    ar: "محرر برمجي يتضمن قدرات ذكاء اصطناعي لفهم المشروع والعمل على الشيفرة.",
    en: "A code editor with AI features for understanding projects and editing code.",
  },
  {
    id: "replit",
    name: "Replit",
    category: "coding",
    url: "https://replit.com/",
    ar: "لإنشاء التطبيقات وتجربتها ونشرها في بيئة تطوير عبر الإنترنت.",
    en: "For building, testing, and deploying applications in an online development environment.",
  },
  {
    id: "perplexity",
    name: "Perplexity",
    category: "research",
    url: "https://www.perplexity.ai/",
    ar: "للبحث على الويب مع إجابات موجزة وروابط للمصادر ذات الصلة.",
    en: "For web research with concise answers and links to relevant sources.",
  },
  {
    id: "notebooklm",
    name: "NotebookLM",
    category: "research",
    url: "https://notebooklm.google/",
    ar: "لفهم المصادر التي تضيفها، وتنظيم الأفكار، وإنشاء ملخصات مبنية عليها.",
    en: "For exploring supplied sources, organizing ideas, and creating source-grounded summaries.",
  },
  {
    id: "consensus",
    name: "Consensus",
    category: "research",
    url: "https://consensus.app/",
    ar: "للبحث في الأبحاث العلمية واستكشاف ما تقوله الدراسات حول سؤال محدد.",
    en: "For searching scientific literature and exploring research evidence on a question.",
  },
  {
    id: "notion-ai",
    name: "Notion AI",
    category: "productivity",
    url: "https://www.notion.so/product/ai",
    ar: "للمساعدة في تنظيم المعرفة والملاحظات والمهام داخل مساحة العمل.",
    en: "For organizing knowledge, notes, and tasks inside a workspace.",
  },
  {
    id: "zapier",
    name: "Zapier",
    category: "productivity",
    url: "https://zapier.com/",
    ar: "لربط التطبيقات وبناء تدفقات عمل تقلل الأعمال اليدوية المتكررة.",
    en: "For connecting apps and building workflows that reduce repetitive manual work.",
  },
  {
    id: "make",
    name: "Make",
    category: "productivity",
    url: "https://www.make.com/",
    ar: "لبناء سيناريوهات مرئية تربط الخدمات والتطبيقات وتنسق خطوات العمل.",
    en: "For visual scenarios that connect services and coordinate workflow steps.",
  },
  {
    id: "canva-magic-design",
    name: "Canva Magic Design",
    category: "design",
    url: "https://www.canva.com/",
    ar: "للبدء في تصميم عروض ومنشورات ومواد بصرية من فكرة أولية.",
    en: "For starting presentations, social posts, and visual assets from an initial idea.",
  },
  {
    id: "figma-ai",
    name: "Figma AI",
    category: "design",
    url: "https://www.figma.com/ai/",
    ar: "لدعم تصميم الواجهات والنماذج الأولية والعمل التعاوني على المنتجات الرقمية.",
    en: "For interface design, prototypes, and collaborative digital product work.",
  },
  {
    id: "framer",
    name: "Framer AI",
    category: "design",
    url: "https://www.framer.com/ai/",
    ar: "للمساعدة في إنشاء صفحات ومواقع ويب انطلاقاً من وصف أو تصور.",
    en: "For getting started with website pages from a written brief or concept.",
  },
  {
    id: "semrush",
    name: "Semrush",
    category: "marketing",
    url: "https://www.semrush.com/",
    ar: "لأبحاث الكلمات المفتاحية وتحليل المنافسين وتحسين الظهور في البحث.",
    en: "For keyword research, competitor analysis, and search visibility workflows.",
  },
  {
    id: "ahrefs",
    name: "Ahrefs",
    category: "marketing",
    url: "https://ahrefs.com/",
    ar: "لتحليل الروابط والكلمات المفتاحية ومتابعة أداء المحتوى في البحث.",
    en: "For backlink and keyword analysis and tracking content performance in search.",
  },
  {
    id: "hubspot",
    name: "HubSpot AI",
    category: "marketing",
    url: "https://www.hubspot.com/",
    ar: "لأعمال التسويق وإدارة علاقات العملاء وصياغة المحتوى ضمن منظومة HubSpot.",
    en: "For marketing workflows, customer relationship management, and content work in HubSpot.",
  },
] as const;
