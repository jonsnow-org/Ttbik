import { lifeStage, titleFor, type Stage } from "@/lib/zenobiaScore";

/**
 * Caravan Passport metadata. The SBT's on-chain content is a fixed "<index>.json" under a base URL;
 * what that file says (stage, picture, title) is computed here, so a holder's passport changes with their journey
 * without any on-chain action.
 */

export const STAGE_IMG: Record<Stage, string> = {
  child: "stage-1-child.jpg",
  queen: "stage-2-queen.jpg",
  warrior: "stage-3-warrior.jpg",
  captive: "stage-4-captive.jpg",
  legend: "stage-5-legend.jpg",
};

const STAGE_LABEL: Record<Stage, string> = { child: "Child", queen: "Queen", warrior: "Warrior", captive: "Captive", legend: "Legend" };

export interface PassportInput {
  index: number;
  joinedAt?: Date | null; // unknown holder -> Child
  points?: number;
  rank?: number;
  total?: number;
  soldAll?: boolean;
  burned?: boolean;
  now?: Date;
}

export function passportMetadata(p: PassportInput, site: string) {
  const now = p.now ?? new Date();
  const days = p.joinedAt ? Math.max(0, Math.floor((now.getTime() - new Date(p.joinedAt).getTime()) / 86400000)) : 0;
  const stage = lifeStage(days, { soldAll: p.soldAll, burned: p.burned });
  const title = titleFor(p.rank ?? 1, Math.max(1, p.total ?? 1));
  return {
    name: `Caravan Passport #${p.index}`,
    description:
      "Soulbound passport of the Zenobia caravan. It cannot be transferred and it grows with its holder's journey. Ranks and titles only; not a promise of any reward.\n" +
      "جواز قافلة زنوبيا. لا يُحوَّل، ويكبر مع رحلة حامله. ترتيب وألقاب فقط، وليس وعدًا بأي مقابل.",
    image: `${site.replace(/\/$/, "")}/zenobia/${STAGE_IMG[stage]}`,
    attributes: [
      { trait_type: "Stage", value: STAGE_LABEL[stage] },
      { trait_type: "Title", value: title.en },
      { trait_type: "Days", value: days },
      { trait_type: "Points", value: p.points ?? 0 },
    ],
  };
}

/** "12.json" -> 12, anything else -> null */
export function parsePassportFile(file: string): number | null {
  const m = /^(\d{1,9})\.json$/.exec(file);
  return m ? Number(m[1]) : null;
}
