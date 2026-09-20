-- Owner directive (2026-09-20): the "channel-ad-slot" service ("أعلن في
-- قناتنا" -- advertise to our own Telegram channel's subscribers, $8)
-- makes a false promise. Our channel has no real audience (a handful of
-- subscribers), so "exposure to our channel's subscribers" is not a real
-- deliverable regardless of whether the ad text technically gets posted.
--
-- This service was deactivated once already, then mistakenly reactivated
-- in migration_catalog_cleanup_2026_09_03.sql on the (wrong) reasoning
-- that "we really do post it, so it's a real deliverable" -- true, but
-- irrelevant if posting it reaches no one. Removing it for good this time:
-- deactivate immediately (takes effect even if the hard delete below is
-- ever blocked), then hard-delete since it was never actually purchased.
--
-- Safety net: orders.service_id is "on delete restrict". If a real
-- historical order turns out to reference this slug, the delete below
-- fails loudly instead of silently orphaning/corrupting that order --
-- tell Claude which order it failed on instead of forcing it through.
update services set is_active = false where slug = 'channel-ad-slot';

delete from services where slug = 'channel-ad-slot';
