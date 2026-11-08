// Muse Spark Open from the Nova bot — its own path, apart from every model (Nova, Sham, Sham v2, candidates).
// The owner writes /muse, /build, /fix or /full in the bot; this opens a GitHub issue in the repository whose workflow `Muse Spark Open` answers it
// (.github/workflows/muse-spark-open.yml, see muse-spark/README.md). The answer comes back to the same chat through telegram-bridge.yml, which sends
// with the bot's own token to the chat id written in the issue. No model of this app is involved and nothing here calls a model.
//   /build <text>, /fix <text>, /muse <text>   normal mode: Muse answers with a comment (plan, analysis, code in the comment)
//   /full <text>                               adds the label `muse-full`: Muse may create a branch, commit and open a pull request (never writes to main)
// Owner only. Needs MUSE_GITHUB_TOKEN (a token that can create issues in MUSE_REPO) and MUSE_REPO ("owner/name").

import { tierFor } from "@/lib/coderAuth";

export type MuseCmd = "build" | "fix" | "full" | "muse";

/** "/full do x" -> {cmd:"full", body:"do x"}; anything that is not one of the four commands -> null (the message goes on to the models as before). */
export function parseMuseCommand(text: string): { cmd: MuseCmd; body: string } | null {
  const m = /^\/(build|fix|full|muse)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec((text || "").trim());
  return m ? { cmd: m[1].toLowerCase() as MuseCmd, body: (m[2] || "").trim() } : null;
}

/** The issue the bridge opens: title "Telegram: [text]", the labels, and the chat marker the relay needs to answer the right chat. */
export function museIssue(cmd: MuseCmd, body: string, chatId: number | string, updateId: number | string) {
  const line = body.split(/\s+/).filter(Boolean).join(" ");
  const title = `Telegram: [${line.slice(0, 90)}${line.length > 90 ? "…" : ""}]`;
  const labels = ["from-telegram", ...(cmd === "full" ? ["muse-full"] : []), ...(cmd === "build" || cmd === "fix" ? [cmd] : [])];
  const text = cmd === "muse" ? body : `/${cmd} ${body}`;
  return { title, labels, body: `${text}\n\n<!-- tg-chat:${chatId} -->\n<!-- tg-update:${updateId} -->` };
}

const HELP = "Muse Spark Open:\n/build <ما تريد بناءه>\n/fix <ما تريد إصلاحه>\n/muse <أي طلب>\n/full <مهمة بصلاحيات كاملة: فرع + طلب دمج، لا يُكتب على main>";

type Api = { sendMessage: (chatId: number, text: string) => Promise<unknown> };

/** true = the update was a Muse command (answered here); false = not ours, the normal flow continues. */
export async function handleMuseUpdate(bot: { api: Api }, update: any, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const msg = update?.message;
  const text = typeof msg?.text === "string" ? msg.text : "";
  const parsed = parseMuseCommand(text);
  const chatId = msg?.chat?.id;
  if (!parsed || !chatId) return false;
  if (tierFor(chatId) !== "owner") return false;                      // for anyone else these remain ordinary messages
  const say = (t: string) => bot.api.sendMessage(chatId, t).catch(() => null);
  const token = (process.env.MUSE_GITHUB_TOKEN || "").trim();
  const repo = (process.env.MUSE_REPO || "jonsnow-org/Ttbik").trim();
  if (!token) { await say("Muse Spark Open غير مفعّل بعد: أضف MUSE_GITHUB_TOKEN في إعدادات الاستضافة (انظر muse-spark/README.md)."); return true; }
  if (!parsed.body) { await say(HELP); return true; }
  try {
    const f = museIssue(parsed.cmd, parsed.body, chatId, update.update_id ?? Date.now());
    const r = await fetchImpl(`https://api.github.com/repos/${repo}/issues`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json", "User-Agent": "nova-muse-bridge" },
      body: JSON.stringify(f),
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) { await say(`تعذّر فتح القضية (HTTP ${r.status}).`); return true; }
    const issue = (await r.json()) as { number?: number };
    await say(`استلمتُ طلبك في Muse Spark Open — القضية #${issue.number}، الوضع: ${parsed.cmd === "full" ? "صلاحيات كاملة (فرع + طلب دمج)" : "عادي (تعليق وتحليل)"}. سيصلك الرد هنا.`);
  } catch (e) {
    await say(`تعذّر الوصول إلى جيتهوب: ${String((e as Error)?.message || e).slice(0, 120)}`);
  }
  return true;
}
