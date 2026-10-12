import { prisma } from "@/lib/prisma";
import { STAGE_IMG_SQ } from "@/lib/zenobiaPassport";
import type { Stage } from "@/lib/zenobiaScore";

/** Silk Road Passport · From Palmyra: 2500 in total, locked for the first 30 days (enforced inside the item contract), then free to trade. */
export const SILK_CAP = 2500;
export const LOCK_DAYS = 30;

/** 1-500: 1 GRAM, 501-1500: 2, 1501-2500: 3. Keep in sync with deploy/oracle/zenobia-ledger/ledger.mjs (which checks the payment itself). */
export const silkPriceGram = (idx: number): number => (idx < 500 ? 1 : idx < 1500 ? 2 : 3);

/** Stage follows the passport's own age; Captive when its current owner holds no ZNB; Legend when it was sent to the dead address. */
export function silkStage(days: number, o: { captive?: boolean; legend?: boolean } = {}): Stage {
  if (o.legend) return "legend";
  if (o.captive) return "captive";
  return days < 10 ? "child" : days < LOCK_DAYS ? "queen" : "warrior";
}

export const isDead = (rawOwner: string | undefined | null) => !rawOwner || /^0:0+$/.test(rawOwner);

const LABEL: Record<Stage, string> = { child: "Child", queen: "Queen", warrior: "Warrior", captive: "Captive", legend: "Legend" };

export function silkMetadata(p: { index: number; mintedAt: Date | null; captive?: boolean; legend?: boolean; now?: Date }, site: string) {
  const now = p.now ?? new Date();
  const days = p.mintedAt ? Math.max(0, Math.floor((now.getTime() - p.mintedAt.getTime()) / 86400000)) : 0;
  const stage = silkStage(days, p);
  const tradable = days >= LOCK_DAYS;
  return {
    name: `Silk Road Passport #${p.index} · From Palmyra`,
    description:
      `Your seat on the Silk Road, from Palmyra. It grows with its age: Child, Queen, Warrior. It cannot be moved for its first ${LOCK_DAYS} days (enforced by the contract), then it can be traded freely. ` +
      "Its perks work while its holder also holds ZNB; without ZNB it shows as Captive. Limited to 2500. Not a promise of any return.\n" +
      `مقعدك على طريق الحرير من تدمر. يكبر بعمره: طفلة ثم ملكة ثم محاربة. لا يُنقل في أول ${LOCK_DAYS} يومًا (يفرضه العقد)، ثم يُباع ويُشترى بحرية. تعمل مزاياه ما دام حامله يملك ZNB، وبدونها يظهر أسيرًا. محدود بـ2500. ليس وعدًا بأي عائد.`,
    image: `${site.replace(/\/$/, "")}/zenobia/${STAGE_IMG_SQ[stage]}`,
    attributes: [
      { trait_type: "Stage", value: LABEL[stage] },
      { trait_type: "Days", value: days },
      { trait_type: "Tradable", value: tradable ? "Yes" : "After day 30" },
    ],
  };
}

let ready: Promise<unknown> | null = null;
export function ensureSilkTables() {
  if (!ready) {
    ready = prisma
      .$executeRawUnsafe(
        `CREATE TABLE IF NOT EXISTS zenobia_silk (id SERIAL PRIMARY KEY, wallet TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'quoted', idx INT UNIQUE, item TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), minted_at TIMESTAMPTZ)`,
      )
      .catch((e) => { ready = null; throw e; });
  }
  return ready;
}

/** A config value shared by the whole Zenobia project (set once by the owner). */
export async function silkConfig(k: string): Promise<string | undefined> {
  const r = (await prisma.$queryRawUnsafe(`SELECT v FROM zenobia_config WHERE k=$1 LIMIT 1`, k)) as { v: string }[];
  return r[0]?.v;
}
