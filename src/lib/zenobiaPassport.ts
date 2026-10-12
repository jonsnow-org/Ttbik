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

/** Square crops of the stage pictures: wallets and explorers show NFT pictures as squares. */
export const STAGE_IMG_SQ: Record<Stage, string> = {
  child: "stage-1-child-sq.jpg",
  queen: "stage-2-queen-sq.jpg",
  warrior: "stage-3-warrior-sq.jpg",
  captive: "stage-4-captive-sq.jpg",
  legend: "stage-5-legend-sq.jpg",
};

/** The living (animated) picture of each stage: 6-second loops, square, served as mp4. */
export const STAGE_ANIM: Record<Stage, string> = {
  child: "stage-1-child.mp4",
  queen: "stage-2-queen.mp4",
  warrior: "stage-3-warrior.mp4",
  captive: "stage-4-captive.mp4",
  legend: "stage-5-legend.mp4",
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
    image: `${site.replace(/\/$/, "")}/zenobia/${STAGE_IMG_SQ[stage]}`,
    content_url: `${site.replace(/\/$/, "")}/zenobia/anim/${STAGE_ANIM[stage]}`,
    content_type: "video/mp4",
    animation_url: `${site.replace(/\/$/, "")}/zenobia/anim/${STAGE_ANIM[stage]}`,
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

/** tonapi's view of an SBT after its holder destroyed it: the owner is gone (or the zero address). */
export function ownerGone(nft: { owner?: { address?: string } | null } | null | undefined): boolean {
  const a = nft?.owner?.address;
  return !a || /^0:0+$/.test(a);
}

/**
 * "Sold everything" for the Captive stage: the wallet held the coin at some point, and is missing from the latest daily snapshot.
 * Snapshots only list holders with a balance, so absence means a zero balance. Unknown when the latest snapshot is old.
 */
export function soldEverything(opts: { jettonSet: boolean; everHeld: boolean; inLatest: boolean; latestDay: string | null; today: string }): boolean {
  if (!opts.jettonSet || !opts.everHeld || opts.inLatest || !opts.latestDay) return false;
  const age = (Date.parse(opts.today) - Date.parse(opts.latestDay)) / 86400000;
  return age <= 3;
}
