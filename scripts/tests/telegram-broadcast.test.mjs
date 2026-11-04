import test from "node:test";
import assert from "node:assert/strict";
import { sendTelegramBroadcast } from "../../src/lib/telegramBroadcast.ts";

test("sends to each valid recipient and counts independent failures", async () => {
  const sent = [];
  const result = await sendTelegramBroadcast(
    ["101", "invalid", "202"],
    "hello",
    async (chatId) => {
      sent.push(chatId);
      if (chatId === 202) throw new Error("bot blocked");
    },
    { batchDelayMs: 0 },
  );

  assert.deepEqual(sent, [101, 202]);
  assert.deepEqual(result, { sent: 1, failed: 2, retried: 0 });
});

test("honours one Telegram 429 retry_after and retries the same recipient", async () => {
  const sent = [];
  const sleeps = [];
  const result = await sendTelegramBroadcast(
    ["101", "202"],
    "hello",
    async (chatId) => {
      sent.push(chatId);
      if (chatId === 101 && sent.filter((id) => id === 101).length === 1) {
        throw Object.assign(new Error("Too Many Requests"), {
          error_code: 429,
          parameters: { retry_after: 3 },
        });
      }
    },
    {
      batchDelayMs: 0,
      sleep: async (milliseconds) => sleeps.push(milliseconds),
    },
  );

  assert.deepEqual(sent, [101, 101, 202]);
  assert.deepEqual(sleeps, [3000]);
  assert.deepEqual(result, { sent: 2, failed: 0, retried: 1 });
});

test("paces messages after each batch and does not retry permanent failures", async () => {
  const sleeps = [];
  const attempted = [];
  const recipients = Array.from({ length: 51 }, (_, index) => String(1000 + index));
  const result = await sendTelegramBroadcast(
    recipients,
    "hello",
    async (chatId) => {
      attempted.push(chatId);
      if (chatId === 1001) {
        throw Object.assign(new Error("bad request"), {
          error_code: 400,
          parameters: { retry_after: 2 },
        });
      }
    },
    {
      batchSize: 25,
      batchDelayMs: 1000,
      sleep: async (milliseconds) => sleeps.push(milliseconds),
    },
  );

  assert.equal(attempted.length, 51);
  assert.deepEqual(sleeps, [1000, 1000]);
  assert.deepEqual(result, { sent: 50, failed: 1, retried: 0 });
});
