/**
 * Contact-sharing guard for the random (anonymous) chat — bot AND Mini App.
 * Blocks phone numbers (Latin/Arabic-Indic/Persian digits, spaced or dashed),
 * @handles, t.me / telegram.me / wa.me / whatsapp links, any URL/domain, and
 * e-mails. Contacts are exchanged only through «📇 طلب تبادل التواصل الرسمي».
 */
export const CONTACT_BLOCKED_TEXT =
  "🔒 لا يمكن مشاركة أرقام الهاتف أو المعرّفات (@) أو الروابط أو البريد الإلكتروني في المراسلة العشوائية.\nلتبادل التواصل بأمان استخدم «📇 طلب تبادل التواصل الرسمي» الذي يظهر بعد 15 رسالة وبموافقة الطرفين.";

export function normalizeDigits(s: string): string {
  return s
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

export function containsContactInfo(raw: string): boolean {
  const s = normalizeDigits(String(raw || "")).normalize("NFKC");
  const lower = s.toLowerCase();
  // 7+ digits once separators (space, dash, dot, brackets, slashes, underscores, +) are removed between digits.
  const digitsRun = s.replace(/(?<=\d)[\s\-–—.()\/_+]+(?=\d)/g, "");
  if (/\d{7,}/.test(digitsRun)) return true;
  if (/(^|[^\w])@[a-z0-9_]{4,}/i.test(s)) return true;
  if (/[a-z0-9._%+-]+\s*(@|\(at\)|\[at\])\s*[a-z0-9-]+\s*(\.|\(dot\)|\[dot\])\s*[a-z]{2,}/i.test(lower)) return true;
  if (/(t\s*\.\s*me|telegram\s*\.\s*(me|dog)|wa\s*\.\s*me|whatsapp\s*\.\s*com|chat\s*\.\s*whatsapp)/i.test(lower)) return true;
  if (/(https?:\/\/|www\.)/i.test(lower)) return true;
  if (/\b[a-z0-9-]{2,}\s*\.\s*(com|net|org|me|io|co|app|link|ly|gg|info|xyz|sa|ae|eg)\b/i.test(lower)) return true;
  return false;
}
