// Thought blocks are for the model, never for the user: every send path (Telegram, Mini App, Nova, LFM2.5, Sham v2, candidates) strips them.
/** Drop <think>…</think> blocks (and an unclosed one at the end, still being written) from text the user will read. */
export function stripThinkTags(text: string): string {
  if (!/<\/?think>/i.test(text)) return text;
  return text.replace(/<think>[\s\S]*?<\/think>\s*/gi, "").replace(/<think>[\s\S]*$/i, "").replace(/<\/think>\s*/gi, "");
}
