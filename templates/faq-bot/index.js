// Free Telegram FAQ bot — answers customer questions from a simple JSON
// list using keyword-overlap matching (no paid NLP APIs, no dependencies).

const fs = require("fs");
const path = require("path");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) {
  console.error("Missing TELEGRAM_BOT_TOKEN environment variable. Get one for free from @BotFather.");
  process.exit(1);
}

const API = `https://api.telegram.org/bot${TOKEN}`;
const faq = JSON.parse(fs.readFileSync(path.join(__dirname, "faq.json"), "utf8"));
const FALLBACK = "لم أفهم سؤالك تماماً، سيتم تحويله لفريق الدعم البشري.";

function tokenize(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .split(/\s+/)
    .filter(Boolean);
}

function bestMatch(userText) {
  const userWords = new Set(tokenize(userText));
  let best = null;
  let bestScore = 0;

  for (const entry of faq) {
    const questionWords = tokenize(entry.question);
    if (questionWords.length === 0) continue; // avoid 0/0 = NaN for empty questions
    const overlap = questionWords.filter((w) => userWords.has(w)).length;
    const score = overlap / questionWords.length;
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }
  return bestScore >= 0.4 ? best : null;
}

// Longer than the 30s long-poll window, so a dead connection can't hang forever.
const REQUEST_TIMEOUT_MS = 45000;

// Calls a Telegram Bot API method and THROWS when Telegram answers with an
// error (bad token 401, another instance running 409, rate limit 429, ...).
// Without this, an error reply looked like "no updates" and the loop spun
// with no delay. The message never includes the bot token.
async function callTelegram(methodAndQuery, options) {
  const res = await fetch(`${API}/${methodAndQuery}`, {
    ...options,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    const err = new Error(
      `Telegram error ${data.error_code || res.status}: ${data.description || "unknown"}`
    );
    err.retryAfter = data.parameters?.retry_after; // seconds, sent on 429
    throw err;
  }
  return data;
}

async function sendMessage(chatId, text) {
  await callTelegram("sendMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

async function poll(offset) {
  const data = await callTelegram(`getUpdates?timeout=30&offset=${offset}`);
  let nextOffset = offset;

  for (const update of data.result || []) {
    nextOffset = update.update_id + 1;
    const message = update.message;
    if (!message?.text) continue;
    try {
      const match = bestMatch(message.text);
      await sendMessage(message.chat.id, match ? match.answer : FALLBACK);
    } catch (err) {
      // A failed reply (user blocked the bot, network blip, ...) must not
      // abort the batch: otherwise the offset isn't advanced and the
      // already-answered messages in this batch get answered again.
      console.error("Reply error:", err.message);
    }
  }
  return nextOffset;
}

async function main() {
  console.log("FAQ bot running (long polling)...");
  let offset = 0;
  for (;;) {
    try {
      offset = await poll(offset);
    } catch (err) {
      console.error("Poll error:", err.message);
      const waitMs = err.retryAfter ? err.retryAfter * 1000 : 3000;
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

main();
