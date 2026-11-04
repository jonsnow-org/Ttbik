
import test from "node:test";
import assert from "node:assert/strict";
import { grokNotificationFrom } from "../../src/lib/grokWebhook.ts";

function update({ text = "مرحبا جروك انا المالك راجع المشروع", sender = 1001, chat = sender, type = "private", isBot = false } = {}) {
  return {
    message: {
      text,
      from: { id: sender, is_bot: isBot },
      chat: { id: chat, type },
    },
  };
}

test("accepts only an authorized owner in their own private chat", () => {
  assert.deepEqual(
    grokNotificationFrom(update(), ["1001", "2002"]),
    { chatId: "1001", text: "مرحبا جروك انا المالك راجع المشروع" },
  );
});

test("rejects an ordinary user even when they know the trigger phrase", () => {
  assert.equal(grokNotificationFrom(update({ sender: 3333 }), ["1001", "2002"]), null);
});

test("rejects group chats and mismatched chat/sender identities", () => {
  assert.equal(grokNotificationFrom(update({ type: "group" }), ["1001"]), null);
  assert.equal(grokNotificationFrom(update({ chat: -1001 }), ["1001"]), null);
});

test("rejects bot senders and malformed or unrelated updates", () => {
  assert.equal(grokNotificationFrom(update({ isBot: true }), ["1001"]), null);
  assert.equal(grokNotificationFrom({ callback_query: {} }, ["1001"]), null);
  assert.equal(grokNotificationFrom(update({ text: "مرحبا" }), ["1001"]), null);
});

test("keeps the existing 500-character forwarding limit", () => {
  const payload = grokNotificationFrom(update({ text: "مرحبا جروك انا المالك " + "x".repeat(800) }), ["1001"]);
  assert.equal(payload?.text.length, 500);
});
