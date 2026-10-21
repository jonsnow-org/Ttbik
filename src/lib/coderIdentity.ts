// The bot's replies speak as SHAM AI by Sham (شام). The underlying model may still name itself or its maker; this rewrites only such
// self-identification phrases in the prose (never inside ``` blocks or `inline code`), so code, logs and quoted text stay untouched.

const MODEL = String.raw`(?:Qwen[\w.\-]*|Tongyi(?:\s+Qianwen)?|通义千问|تونغي(?:\s+تشيانوين)?|كوين|Coder|كودر|the\s+coder|ChatGPT|GPT-?[\w.]*|Claude|Llama[\w.\-]*|Gemini|DeepSeek[\w.\-]*|Mistral[\w.\-]*)`;
const MAKER = String.raw`(?:Alibaba(?:\s+Cloud|\s+Group)?(?:'s)?(?:\s+(?:Tongyi\s+Lab|Qwen\s+team|DAMO\s+Academy))?|the\s+Qwen\s+team|Qwen\s+team|Tongyi\s+Lab|علي\s?بابا(?:\s+كلاود)?|سحابة\s+علي\s?بابا|أليبابا|اليبابا|OpenAI|Anthropic|Meta(?:\s+AI)?|Google(?:\s+DeepMind)?|Groq|ModelScope|DAMO\s+Academy)`;

const RULES: Array<[RegExp, string]> = [
  // "أنا Qwen" / "أنا **Coder**" / "أنا نموذج Qwen" / "اسمي Qwen"
  [new RegExp(String.raw`(أنا|انا|اسمي)(\s+)(?:نموذج\s+(?:لغوي\s+)?(?:كبير\s+)?(?:اسمه\s+|يدعى\s+|يُدعى\s+)?)?(\*\*|__)?${MODEL}(\*\*|__)?`, "giu"), "$1$2$3SHAM AI$4"],
  // "I am Qwen" / "I'm Coder" / "my name is Qwen" / "I am a large language model called Qwen"
  [new RegExp(String.raw`\b(I\s+am|I'm|my\s+name\s+is|call\s+me)(\s+)(?:an?\s+(?:large\s+)?(?:language\s+)?model\s+(?:called|named)\s+)?(\*\*|__)?${MODEL}(\*\*|__)?`, "gi"), "$1$2$3SHAM AI$4"],
  // "developed by Alibaba Cloud" / "created by the Qwen team"
  [new RegExp(String.raw`\b(developed|created|built|trained|made|designed|provided)(\s+by\s+)${MAKER}`, "gi"), "$1$2Sham"],
  // "طوّرتني شركة علي بابا" / "تم تطويري من قبل Alibaba Cloud" / "من تطوير علي بابا"
  [new RegExp(String.raw`((?:تم\s+)?(?:تطويري|تدريبي|إنشائي|انشائي|صنعي|برمجتي|تصميمي)(?:\s+(?:من\s+قِ?بل|بواسطة|على\s+يد|من))?\s+|(?:طوّرتني|طورتني|صنعتني|أنشأتني|انشأتني|درّبتني|دربتني)\s+|من\s+تطوير\s+|من\s+إنتاج\s+)(?:شركة\s+|فريق\s+)?${MAKER}`, "giu"), "$1شام (Sham)"],
  // "نموذج من Alibaba" said about itself: "أنا نموذج لغوي من علي بابا"
  [new RegExp(String.raw`((?:أنا|انا)\s+[^.\n]{0,40}?\s(?:من|لدى|تابع\s+لـ?)\s*)(?:شركة\s+)?${MAKER}`, "giu"), "$1شام (Sham)"],
];

function brandProse(s: string): string {
  // keep `inline code` as it is
  return s.split(/(`[^`\n]*`)/g).map((p, i) => (i % 2 ? p : RULES.reduce((t, [re, to]) => t.replace(re, to), p))).join("");
}

/** The reply with the model's self-references turned into SHAM AI by Sham; code blocks and inline code are never changed. */
export function brandSelfReferences(text: string): string {
  const parts = String(text || "").split(/(^\s*```[^\n]*$[\s\S]*?(?:^\s*```\s*$|(?![\s\S])))/m);
  return parts.map((p, i) => (i % 2 ? p : brandProse(p))).join("");
}
