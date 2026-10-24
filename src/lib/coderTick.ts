// The one piece of work behind every "tick" of the coder: claim the scheduled tasks that are due and start each in its own function call,
// then (in the background) one item of quiet-time work for the conversation threads. Two callers: the GitHub Actions scheduler
// (/api/coder/schedules/tick, whose real cadence is hours: GitHub delays scheduled runs) and the Oracle VM's every-minute sweeper
// (/api/internal/fake-chat-sweep), which is what makes scheduled tasks run on time. A schedule is claimed with one atomic UPDATE, so two
// callers in the same minute never start it twice.
import { claimDue, fanOut } from "@/lib/coderSchedules";
import { prismaDb, type Db } from "@/lib/coderAuth";
import { later, resumeOrphan, selfUrl } from "@/lib/coderSections";
import { claimOrphanTasks } from "@/lib/coderTasks";
import { prisma } from "@/lib/prisma";

let lastQuiet = 0;                                       // quiet-time work at most every 5 minutes per server, however often the tick comes

export async function runCoderTick(db: Db = prismaDb, now = new Date()): Promise<{ due: number; sent: number; failed: string[] }> {
  const claimed = await claimDue(db, now).catch(() => []);
  const sent = claimed.length ? await fanOut(claimed, selfUrl()) : [];
  // runs whose server was replaced or killed mid-leg: pick them up here (every minute) instead of waiting for the user to write again
  if (db === prismaDb) {
    for (const o of await claimOrphanTasks(db)) {
      const botRow = await prisma.bot.findUnique({ where: { id: o.botId } }).catch(() => null);
      if (botRow?.isActive) await resumeOrphan(o.chatId, o.run_id, o.slot, botRow, db).catch(() => false);
    }
  }
  // long-term memories and summaries of long threads: one item per tick, only while the Studio queue is empty and that user is quiet
  if (db === prismaDb && Date.now() - lastQuiet >= 300000) {
    lastQuiet = Date.now();
    later(() => import("@/lib/coderThreads").then((m) => m.quietWork()).then(() => undefined).catch(() => undefined));
  }
  return { due: claimed.length, sent: sent.filter((x) => x.ok).length, failed: sent.filter((x) => !x.ok).map((x) => x.id) };
}
