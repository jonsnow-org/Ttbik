// Limits of the daily bot-update-announcements cron (src/app/api/cron/bot-update-announcements). They live here because a Next.js route file may export only handlers.
/** An announcement that has waited longer than this is stale: closed without sending (after a scheduler outage the whole backlog would otherwise go out in one burst). */
export const ANNOUNCEMENT_MAX_AGE_MS = 72 * 3600 * 1000;
/** At most this many announcements are broadcast per run, oldest first; the rest go on the next run. */
export const MAX_BROADCASTS_PER_RUN = 3;
