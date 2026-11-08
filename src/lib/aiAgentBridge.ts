// AI Agent from the Nova bot — its own path, apart from every model (Nova, Sham, Sham v2, LFM).
// The owner writes /ai, /build, /fix or /full in the bot; this opens a GitHub issue in the repository whose workflow `AI Agent` answers it
// (.github/workflows/ai-agent.yml, see ai-agent/README.md). The answer comes back to the same chat through ai-telegram-bridge.yml, which sends
// with the bot's own token to the chat id written in the issue. No model of this app is involved and nothing here calls a model.
//   /build <text>, /fix <text>, /ai <text>   normal mode: AI answers with a comment (plan, analysis, code in the comment)
//   /full <text>                               adds the label `ai-full`: AI may create a branch, commit and open a pull request (never writes to main)
// Owner only. Needs AI_GITHUB_TOKEN (a token that can create issues in AI_REPO) and AI_REPO ("owner/name").

import { tierFor } from "@/lib/coderAuth";
import { getSecret, handleSecretUpdate } from "@/lib/hostedSecrets";

export type AICmd = "build" | "fix" | "full" | "ai";

/** "/full do x" -> {cmd:"full", body:"do x"}; anything that is not one of the four commands -> null (the message goes on to the models as before). */
export function parseAiCommand(text: string): { cmd: AICmd; body: string } | null {
  const m = /^\/(build|fix|full|ai)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec((text || "").trim());
  return m ? { cmd: m[1].toLowerCase() as AICmd, body: (m[2] || "").trim() } : null;
}

/** The issue the bridge opens: title "Telegram: [text]", the labels, and the chat marker the relay needs to answer the right chat. */
export function aiAgentIssue(cmd: AICmd, body: string, chatId: number | string, updateId: number | string) {
  const line = body.split(/\s+/).filter(Boolean).join(" ");
  const title = `Telegram: [${line.slice(0, 90)}${line.length > 90 ? "…" : ""}]`;
  const labels = ["from-telegram", ...(cmd === "full" ? ["ai-full"] : []), ...(cmd === "build" || cmd === "fix" ? [cmd] : [])];
  const text = cmd === "ai" ? body : `/${cmd} ${body}`;
  return { title, labels, body: `${text}\n\n<!-- tg-chat:${chatId} -->\n<!-- tg-update:${updateId} -->` };
}

const HELP = "AI Agent:\n/build <ما تريد بناءه>\n/fix <ما تريد إصلاحه>\n/ai <أي طلب>\n/full <مهمة بصلاحيات كاملة: فرع + طلب دمج، لا يُكتب على main>";

type Api = { sendMessage: (chatId: number, text: string) => Promise<unknown> };

/** true = the update was a AI command (answered here); false = not ours, the normal flow continues. */
export async function handleAiAgentUpdate(bot: { api: Api }, update: any, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (await handleSecretUpdate(bot, update)) return true;           // /secret NAME VALUE (owner only, the message is deleted)
  const msg = update?.message;
  const text = typeof msg?.text === "string" ? msg.text : "";
  const parsed = parseAiCommand(text);
  const chatId = msg?.chat?.id;
  if (!parsed || !chatId) return false;
  if (tierFor(chatId) !== "owner") return false;                      // for anyone else these remain ordinary messages
  const say = (t: string) => bot.api.sendMessage(chatId, t).catch(() => null);
  const token = await getSecret("AI_GITHUB_TOKEN");
  const repo = (await getSecret("AI_REPO")) || "jonsnow-org/Ttbik";
  if (!token) { await say("AI Agent غير مفعّل بعد: أرسل /secret AI_GITHUB_TOKEN <القيمة> هنا (انظر ai-agent/README.md)."); return true; }
  if (!parsed.body) { await say(HELP); return true; }
  try {
    const f = aiAgentIssue(parsed.cmd, parsed.body, chatId, update.update_id ?? Date.now());
    const r = await fetchImpl(`https://api.github.com/repos/${repo}/issues`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json", "User-Agent": "nova-ai-bridge" },
      body: JSON.stringify(f),
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) { await say(`تعذّر فتح القضية (HTTP ${r.status}).`); return true; }
    const issue = (await r.json()) as { number?: number };
    await say(`استلمتُ طلبك في AI Agent — القضية #${issue.number}، الوضع: ${parsed.cmd === "full" ? "صلاحيات كاملة (فرع + طلب دمج)" : "عادي (تعليق وتحليل)"}. سيصلك الرد هنا.`);
  } catch (e) {
    await say(`تعذّر الوصول إلى جيتهوب: ${String((e as Error)?.message || e).slice(0, 120)}`);
  }
  return true;
}
