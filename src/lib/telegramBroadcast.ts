export type TelegramBroadcastResult = {
  sent: number;
  failed: number;
  retried: number;
};

export type TelegramSendMessage = (
  chatId: number,
  text: string,
) => Promise<unknown>;

export type TelegramBroadcastOptions = {
  batchSize?: number;
  batchDelayMs?: number;
  maxAttempts?: number;
  maxRetryAfterSeconds?: number;
  sleep?: (milliseconds: number) => Promise<void>;
};

function getRetryAfterSeconds(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;

  const value = error as {
    error_code?: unknown;
    errorCode?: unknown;
    parameters?: { retry_after?: unknown };
  };
  const code = value.error_code ?? value.errorCode;
  const retryAfter = Number(value.parameters?.retry_after);

  if (Number(code) !== 429 || !Number.isFinite(retryAfter) || retryAfter <= 0) {
    return null;
  }

  return retryAfter;
}

const defaultSleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export async function sendTelegramBroadcast(
  recipientIds: string[],
  message: string,
  sendMessage: TelegramSendMessage,
  options: TelegramBroadcastOptions = {},
): Promise<TelegramBroadcastResult> {
  const batchSize = Math.max(1, Math.floor(options.batchSize ?? 25));
  const batchDelayMs = Math.max(0, options.batchDelayMs ?? 1000);
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? 2));
  const maxRetryAfterSeconds = Math.max(0, options.maxRetryAfterSeconds ?? 10);
  const sleep = options.sleep ?? defaultSleep;

  let sent = 0;
  let failed = 0;
  let retried = 0;

  for (let index = 0; index < recipientIds.length; index++) {
    const chatId = Number(recipientIds[index]);
    let delivered = false;

    if (Number.isSafeInteger(chatId) && chatId > 0) {
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          await sendMessage(chatId, message);
          sent++;
          delivered = true;
          break;
        } catch (error) {
          const retryAfter = getRetryAfterSeconds(error);
          const canRetry =
            attempt + 1 < maxAttempts &&
            retryAfter !== null &&
            retryAfter <= maxRetryAfterSeconds;

          if (!canRetry) break;

          retried++;
          await sleep(retryAfter * 1000);
        }
      }
    }

    if (!delivered) failed++;

    if (
      batchDelayMs > 0 &&
      (index + 1) % batchSize === 0 &&
      index + 1 < recipientIds.length
    ) {
      await sleep(batchDelayMs);
    }
  }

  return { sent, failed, retried };
}
