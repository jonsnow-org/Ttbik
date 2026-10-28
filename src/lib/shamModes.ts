// The user's thinking / accuracy / speed settings, made REAL for Sham (they are not just buttons). Nova's Studio takes them as a temperature, a thinking switch with a cap
// and a note in the request; Sham gets the same three things in its own ways:
//   - accuracy "fast"     : a shorter answer budget (x0.6), one correction round for a wrong tool call, hotter sampling (0.7), a short thought if thinking is on;
//   - accuracy "balanced" : the normal budget, two correction rounds, 0.6;
//   - accuracy "precise"  : a longer answer budget (x1.5), three correction rounds, cold sampling (0.2), a long thought if thinking is on, and the model is told to double-check;
//   - thinking            : only a body that can think (the new Sham v2 on the Qwen3 body) gets it: the Studio lets it write a thought of at most thinkCap/3 tokens before the
//                           answer and strips it. The old Sham body cannot think: the switch changes nothing there, and the picker says so.
// The sampling and thinking settings travel to the Studio as ONE header line at the start of the prompt ("[[sham temp=0.20 think=300]]"), read and removed by
// ai-system/colab/sham_small/sham_studio_chat.py (hot code). A Studio that does not have that code yet would show the line to the model, so the header is sent only to the new
// Studio, or to the old one once SHAM_MODES=on says its hot code has the reader.

export type ShamMode = { accuracy?: "fast" | "balanced" | "precise"; auto?: boolean; think?: boolean; thinkCap?: number; temperature?: number; media?: boolean; memory?: { remember: boolean; recall: boolean; save: boolean } };

export type ShamKnobs = { maxNewFactor: number; corrections: number; temperature: number; thinkTokens: number; header: string; note: string };

const TEMP = { fast: 0.7, balanced: 0.6, precise: 0.2 } as const;

export function shamKnobs(mode?: ShamMode, variant?: "v1" | "v2"): ShamKnobs {
  const acc = mode?.accuracy === "fast" || mode?.accuracy === "precise" ? mode.accuracy : "balanced";
  const v2 = variant === "v2";
  const temperature = typeof mode?.temperature === "number" ? mode.temperature : TEMP[acc];
  const thinkTokens = v2 && mode?.think ? Math.max(32, Math.round((mode.thinkCap || (acc === "fast" ? 500 : acc === "precise" ? 3000 : 1200)) / 3)) : 0;
  const send = v2 || (process.env.SHAM_MODES || "").trim().toLowerCase() === "on";
  const header = send ? `[[sham temp=${temperature.toFixed(2)}${thinkTokens ? ` think=${thinkTokens}` : ""}]]\n` : "";
  const note = !v2 ? "" : acc === "precise" ? "المستخدم اختار أقصى دقة: راجع كل معلومة وكل سطر كود قبل الجزم، وقل بصراحة إن لم تكن متأكداً." : acc === "fast" ? "المستخدم يفضّل جواباً سريعاً ومختصراً." : "";
  return { maxNewFactor: acc === "fast" ? 0.6 : acc === "precise" ? 1.5 : 1, corrections: acc === "fast" ? 1 : acc === "precise" ? 3 : 2, temperature, thinkTokens, header, note };
}
