import { randomBytes } from "crypto";
// No-code mini-app builder (/create → «صانع التطبيقات»). An app is a JSON config rendered by src/app/apps/[slug]/page.tsx as a
// Telegram Mini App / installable web page. Pure validation + rule-based building here (unit-tested); storage in hubDb.ts.
// Scope is honest: web/PWA mini apps hosted on this site — not native App Store / Play publishing.

export const APP_TEMPLATES = {
  store: { label: "متجر", icon: "🛒", itemLabel: "منتج" },
  booking: { label: "حجز مواعيد", icon: "📅", itemLabel: "خدمة" },
  menu: { label: "قائمة مطعم", icon: "🍽️", itemLabel: "صنف" },
  portfolio: { label: "معرض أعمال", icon: "🎨", itemLabel: "عمل" },
  links: { label: "صفحة روابط", icon: "🔗", itemLabel: "رابط" },
  quiz: { label: "اختبار", icon: "❓", itemLabel: "سؤال" },
} as const;
export type AppTemplate = keyof typeof APP_TEMPLATES;

export type AppItem = { title: string; desc?: string; price?: string; url?: string; options?: string[]; answer?: number };
export type AppConfig = {
  template: AppTemplate;
  title: string;
  tagline?: string;
  color: string; // #rrggbb
  contact?: string; // telegram username / whatsapp number / url used by order & booking buttons
  items: AppItem[];
};

export const MAX_ITEMS = 30;
export const MAX_APPS_PER_USER = 3;
const COLORS: Record<string, string> = {
  احمر: "#dc2626", أحمر: "#dc2626", ازرق: "#2563eb", أزرق: "#2563eb", اخضر: "#16a34a", أخضر: "#16a34a", اسود: "#111827", أسود: "#111827",
  بنفسجي: "#7c3aed", برتقالي: "#ea580c", وردي: "#db2777", ذهبي: "#b8860b", بني: "#7c4a1e", رمادي: "#4b5563", سماوي: "#0891b2",
  red: "#dc2626", blue: "#2563eb", green: "#16a34a", black: "#111827", purple: "#7c3aed", orange: "#ea580c", pink: "#db2777", gold: "#b8860b",
};

const clip = (s: unknown, n: number) => String(s ?? "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, n);
const safeUrl = (u: unknown): string | undefined => {
  const s = String(u ?? "").trim();
  return /^https:\/\/[^\s"'<>]{3,300}$/i.test(s) ? s : undefined;
};

export type ValidateResult = { ok: true; config: AppConfig } | { ok: false; error: string };

/** Accepts anything (user JSON / model JSON) and returns a clean config or an Arabic error. Strips HTML, non-https links, extras. */
export function validateAppConfig(raw: unknown): ValidateResult {
  if (!raw || typeof raw !== "object") return { ok: false, error: "إعدادات التطبيق غير صالحة" };
  const r = raw as Record<string, unknown>;
  const template = String(r.template || "") as AppTemplate;
  if (!(template in APP_TEMPLATES)) return { ok: false, error: "اختر قالباً: متجر، حجز، قائمة مطعم، معرض أعمال، روابط، اختبار" };
  const title = clip(r.title, 60);
  if (title.length < 2) return { ok: false, error: "اسم التطبيق مطلوب (حرفان على الأقل)" };
  const color = /^#[0-9a-fA-F]{6}$/.test(String(r.color || "")) ? String(r.color).toLowerCase() : "#4f46e5";
  const itemsIn = Array.isArray(r.items) ? r.items : [];
  if (itemsIn.length > MAX_ITEMS) return { ok: false, error: `الحد الأقصى ${MAX_ITEMS} عنصراً` };
  const items: AppItem[] = [];
  for (const it of itemsIn) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const t = clip(o.title, 80);
    if (!t) continue;
    const item: AppItem = { title: t };
    const d = clip(o.desc, 240);
    if (d) item.desc = d;
    const p = clip(o.price, 20);
    if (p) item.price = p;
    const u = safeUrl(o.url);
    if (u) item.url = u;
    if (template === "links" && !u) continue; // a link without a valid https url is useless
    if (template === "quiz") {
      const opts = Array.isArray(o.options) ? o.options.map((x) => clip(x, 60)).filter(Boolean).slice(0, 4) : [];
      const ans = Number(o.answer);
      if (opts.length < 2 || !Number.isInteger(ans) || ans < 0 || ans >= opts.length) continue;
      item.options = opts;
      item.answer = ans;
    }
    items.push(item);
  }
  const contact = clip(r.contact, 80).replace(/[^\w@+.:/\-]/g, "") || undefined;
  const tagline = clip(r.tagline, 120) || undefined;
  return { ok: true, config: { template, title, tagline, color, contact, items } };
}

/** Which template a natural-language description asks for (Arabic dialects + English). */
export function detectTemplate(text: string): AppTemplate | null {
  const t = (text || "").toLowerCase();
  if (/منيو|مطعم|كافيه|كافي|قهوه|قهوة|مقهى|وجبات|قائمة طعام|menu|restaurant|cafe/.test(t)) return "menu";
  if (/حجز|مواعيد|موعد|صالون|عياده|عيادة|حلاق|booking|appointment/.test(t)) return "booking";
  if (/اختبار|كويز|مسابقه|مسابقة|اسئله|أسئلة|quiz/.test(t)) return "quiz";
  if (/روابط|لينكات|حساباتي|link ?tree|links/.test(t)) return "links";
  if (/معرض|اعمالي|أعمالي|بورتفوليو|portfolio|تصاميمي|صوري/.test(t)) return "portfolio";
  if (/متجر|محل|بيع|منتجات|دكان|store|shop/.test(t)) return "store";
  return null;
}

export function detectColor(text: string): string | null {
  for (const [w, hex] of Object.entries(COLORS)) if ((text || "").toLowerCase().includes(w)) return hex;
  return null;
}

export function detectTitle(text: string): string | null {
  const m = (text || "").match(/(?:اسمه|اسمها|باسم|بإسم|بعنوان|عنوانه|named|called)\s*[«"']?([^«»"'\n،,.!؟?]{2,40})/i);
  return m ? m[1].split(/\s+(?:باللون|بلون|لونه|مع|فيه|يبيع|لبيع|ل)\s/)[0].trim() : null;
}

const DEFAULT_ITEMS: Record<AppTemplate, AppItem[]> = {
  store: [{ title: "منتج 1", desc: "وصف قصير", price: "10$" }, { title: "منتج 2", desc: "وصف قصير", price: "15$" }],
  booking: [{ title: "استشارة 30 دقيقة", price: "20$" }, { title: "جلسة ساعة", price: "35$" }],
  menu: [{ title: "قهوة عربية", price: "2$" }, { title: "فطور شامي", price: "6$" }],
  portfolio: [{ title: "مشروع 1", desc: "وصف العمل" }, { title: "مشروع 2", desc: "وصف العمل" }],
  links: [{ title: "قناتي على تيليجرام", url: "https://t.me/" }],
  quiz: [{ title: "ما عاصمة سوريا؟", options: ["دمشق", "حلب", "حمص"], answer: 0 }],
};

/** Rule-based app from a description — works with no AI at all; the AI only fills better items on top (hubTools.ts). */
export function buildFromDescription(text: string, forced?: AppTemplate): AppConfig {
  const template = forced || detectTemplate(text) || "store";
  const title = detectTitle(text) || `${APP_TEMPLATES[template].label} جديد`;
  const v = validateAppConfig({ template, title, color: detectColor(text) || "#4f46e5", items: DEFAULT_ITEMS[template] });
  return (v as { ok: true; config: AppConfig }).config;
}

export type EditResult = { config: AppConfig; changed: string | null };
/**
 * Instant updates by chat, natural language (no slash commands):
 *   «غيّر الاسم إلى X» «غير اللون أحمر» «أضف منتج قهوة بسعر 3$» «احذف قهوة» «الوصف: …» «التواصل @user»
 */
export function applyChatEdit(cfg: AppConfig, text: string): EditResult {
  const t = (text || "").trim();
  const c: AppConfig = JSON.parse(JSON.stringify(cfg));
  let m: RegExpMatchArray | null;
  if ((m = t.match(/(?:غير|غيّر|بدل|بدّل|عدل|عدّل)\s*(?:ال)?(?:اسم|عنوان)\s*(?:التطبيق)?\s*(?:الى|إلى|ل|لـ)?\s*[:«"]?\s*(.{2,60})/))) {
    c.title = m[1].replace(/[»"]$/, "").trim();
  } else if (/(?:لون|اللون|color)/i.test(t) && detectColor(t)) {
    c.color = detectColor(t)!;
  } else if ((m = t.match(/(?:اضف|أضف|ضيف|زيد|add)\s+(?:منتج|صنف|خدمه|خدمة|عمل|رابط|عنصر|item)?\s*(.{2,60}?)(?:\s+(?:بسعر|سعره|ب)\s*([\d.,]+\s*\S{0,4}))?(?:\s+(https:\/\/\S+))?$/i))) {
    if (c.items.length >= MAX_ITEMS) return { config: cfg, changed: null };
    const item: AppItem = { title: m[1].trim() };
    if (m[2]) item.price = m[2].trim();
    if (m[3]) item.url = m[3];
    c.items.push(item);
  } else if ((m = t.match(/(?:احذف|امسح|شيل|remove|delete)\s+(.{2,60})/i))) {
    const name = m[1].trim();
    const before = c.items.length;
    c.items = c.items.filter((i) => i.title !== name);
    if (c.items.length === before) return { config: cfg, changed: null };
  } else if ((m = t.match(/^(?:الوصف|الشعار|tagline)\s*[:：]\s*(.{2,120})/i))) {
    c.tagline = m[1].trim();
  } else if ((m = t.match(/^(?:التواصل|تواصل|رقمي|معرفي|contact)\s*[:：]?\s*(\S{3,80})/i))) {
    c.contact = m[1].trim();
  } else {
    return { config: cfg, changed: null };
  }
  const v = validateAppConfig(c);
  if (!v.ok) return { config: cfg, changed: null };
  return { config: v.config, changed: "ok" };
}

export function makeSlug(title: string): string {
  const base = (title || "app").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 20);
  const rnd = randomBytes(4).toString("hex");
  return base ? `${base}-${rnd}` : `app-${rnd}`;
}
