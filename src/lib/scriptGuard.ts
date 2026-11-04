// An Arabic reply never carries fragments of another script: MiniCPM leaked «的人工智能助手» and Sham v2 leaked Vietnamese words into Arabic.
// Only applies when the text has Arabic letters; code, links and plain English/Latin names are kept (only Vietnamese-marked words are dropped).
const ARABIC = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;
const CJK = /[\u2E80-\u2FDF\u3000-\u303F\u3040-\u30FF\u3100-\u312F\u3130-\u318F\u31A0-\u31FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF]+/g;
const VIET_CHARS = "ăâđêôơưĂÂĐÊÔƠƯạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼẾỀỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴỶỸ";
const VIET_WORD = new RegExp("[A-Za-z\\u00C0-\\u024F\\u1E00-\\u1EFF]*[" + VIET_CHARS + "][A-Za-z\\u00C0-\\u024F\\u1E00-\\u1EFF]*", "g");
// a run of Latin words (spaces between) that holds a Vietnamese-marked word: its accented words go too ("là", "lý"); plain ASCII words (names) stay
const LATIN_RUN = /[A-Za-z\u00C0-\u024F\u1E00-\u1EFF]+(?:\s+[A-Za-z\u00C0-\u024F\u1E00-\u1EFF]+)*/g;
const dropViet = (part: string): string => part.replace(LATIN_RUN, (run) => {
  VIET_WORD.lastIndex = 0;
  if (!VIET_WORD.test(run)) return run;
  return run.split(/\s+/).filter((w) => /^[A-Za-z]+$/.test(w)).join(" ");
});

export function stripForeignScript(text: string): string {
  const s = String(text ?? "");
  if (!ARABIC.test(s)) return s;
  CJK.lastIndex = 0; VIET_WORD.lastIndex = 0;
  if (!CJK.test(s) && !VIET_WORD.test(s)) return s;
  // keep fenced code untouched
  return s.split(/(```[\s\S]*?```)/).map((part, i) => i % 2 ? part : dropViet(part.replace(CJK, " ")).replace(/[ \t]{2,}/g, " ").replace(/ +([.,!?،؛])/g, "$1")).join("").trim();
}

// Persian-only letters (پ چ ژ گ ک ی): an Arabic user never writes them; a reply full of them is Persian, not Arabic
// (live Sham v2 2026-11-04: «من انت» → «به نظرم، من انت چی؟ ...», because «من» is "I" in Persian).
const PERSIAN_ONLY = /[\u067E\u0686\u0698\u06AF\u06A9\u06CC]/g;
export function isPersianLeak(userText: string, reply: string): boolean {
  const u = String(userText ?? ""), r = String(reply ?? "");
  if (!ARABIC.test(u) || (u.match(PERSIAN_ONLY) || []).length > 0) return false;
  return (r.match(PERSIAN_ONLY) || []).length >= 3;
}
/** The same request with one Arabic-only note on the user's turn (used for a single retry). */
export const ARABIC_ONLY_NOTE = "\n\n(أجب بالعربية فقط، لا بالفارسية ولا بأي لغة أخرى.)";
