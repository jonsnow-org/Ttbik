// ONE context size for everything. The model server (llama.cpp -c, see ai-system/modelscope-coder/app.py CODER_CTX) is the hard limit; the bot used to
// carry several separate character budgets (history 40,000, segment 52,500, agent reports 60,000) that assumed 32,768 tokens. They are all derived
// from this one number now, so raising the Studios' context raises the limits for every model run and every agent at once. The number comes from the
// Studios themselves (their status reports `ctx`; the smallest of the ones seen wins, so no call can overflow the weakest Studio); CODER_CTX_TOKENS
// forces a value; nothing known = 32,768, the old behaviour.
export const DEFAULT_CTX = 32768;
const seen = new Map<string, number>();

export function noteStudioCtx(base: string, ctx: unknown): void {
  const n = Number(ctx);
  if (Number.isFinite(n) && n >= 8192) seen.set(base, Math.floor(n));
}
export function forgetStudioCtx(): void { seen.clear(); }

export function ctxTokens(): number {
  const forced = Number(process.env.CODER_CTX_TOKENS);
  if (Number.isFinite(forced) && forced >= 8192) return Math.floor(forced);
  return seen.size ? Math.min(...seen.values()) : DEFAULT_CTX;
}
const scaled = (perCtx: number) => Math.round((ctxTokens() * perCtx) / DEFAULT_CTX);
/** What the model sees of the history each step (old default 40,000 characters at 32k tokens). */
export const historyChars = (): number => Number(process.env.CODER_HISTORY_CHARS) || scaled(40000);
/** When a long task closes its segment with a checkpoint summary (old 52,500 at 32k). */
export const segmentCharsFor = (): number => Math.max(8000, Number(process.env.CODER_SEGMENT_CHARS) || scaled(52500));
/** All agent reports together before the system condenses (old 60,000 at 32k). */
export const reportsHardChars = (): number => Math.max(12000, Number(process.env.CODER_AGENT_REPORTS_HARD) || scaled(60000));
