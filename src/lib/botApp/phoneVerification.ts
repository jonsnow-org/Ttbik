export type PhoneVerificationSnapshot = {
  ok: boolean;
  phoneVerified?: boolean;
};

/**
 * A Telegram requestContact callback only confirms that the user accepted the native
 * prompt. The actual contact is delivered separately to the bot webhook; callers must
 * wait until the bot's backend reports phoneVerified=true before unlocking the app.
 */
export async function waitForPhoneVerification(
  read: () => Promise<PhoneVerificationSnapshot>,
  options: {
    attempts?: number;
    intervalMs?: number;
    delay?: (ms: number) => Promise<void>;
  } = {},
): Promise<boolean> {
  const attempts = Math.max(1, Math.min(60, Math.floor(options.attempts ?? 20)));
  const intervalMs = Math.max(0, Math.min(5_000, Math.floor(options.intervalMs ?? 1_000)));
  const delay = options.delay ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const current = await read();
      if (current.ok && current.phoneVerified === true) return true;
    } catch {
      // Telegram may deliver the contact webhook a little later. Retry transient reads.
    }
    if (attempt + 1 < attempts && intervalMs > 0) await delay(intervalMs);
  }
  return false;
}
