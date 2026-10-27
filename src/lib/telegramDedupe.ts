// Telegram re-delivers a webhook it thinks was too slow to answer (same update_id). For the coder (Nova) path that meant the SAME user message reached
// handleCoderSections twice: while the first run was streaming, the copy was pushed to the run's inbox as a follow-up and, once the first answer was
// done, answered AGAIN with its own progress card ("started the task ... writing ...") — two full replies to one message.
// This claim is taken before anything else happens: only the first delivery of an update id goes on. Neutral (no Sham or Nova imports).
import { prismaDb, type Db } from "@/lib/coderAuth";

let ready = false;

/** true = first time this update is seen (go on); false = a Telegram retry of an update already taken (skip it). No update id = nothing to dedupe. */
export async function claimTelegramUpdate(scope: string, chatId: number | string, updateId: number | undefined, db: Db = prismaDb): Promise<boolean> {
  if (!updateId) return true;
  try {
    if (!(db === prismaDb && ready)) {
      await db.exec(`CREATE TABLE IF NOT EXISTS tg_seen_updates (scope TEXT NOT NULL, chat_id BIGINT NOT NULL, update_id BIGINT NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (scope, chat_id, update_id))`);
      if (db === prismaDb) ready = true;
    }
    if (Math.random() < 0.02) await db.exec(`DELETE FROM tg_seen_updates WHERE at < now() - interval '1 day'`);
    const rows = await db.query<{ update_id: string }>(`INSERT INTO tg_seen_updates (scope, chat_id, update_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING update_id`, scope, Number(chatId), updateId);
    return rows.length > 0;
  } catch { return true; }               // the store is down: better a possible duplicate than a lost message
}
