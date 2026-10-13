import { prisma } from "@/lib/prisma";

let ready: Promise<void> | null = null;
export function ensureHiddenTable(): Promise<void> {
  if (!ready) {
    ready = prisma
      .$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS znbt_hidden (curve TEXT PRIMARY KEY, reason TEXT, hidden_at TIMESTAMPTZ NOT NULL DEFAULT now())`)
      .then(() => undefined)
      .catch((e) => { ready = null; throw e; });
  }
  return ready;
}

/** The secret signing the challenge is derived from the Zenobia bot's own token (no new secret to configure). */
export async function hideSecret(): Promise<string | null> {
  const bot = await prisma.bot.findFirst({ where: { template: "ZENOBIA_BOT", isActive: true } });
  return bot?.token ?? null;
}
