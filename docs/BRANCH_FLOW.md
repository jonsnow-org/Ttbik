
---

## The Oracle path: what the alert means and what to do / مسار Oracle
"⚠️ Oracle is not answering; the gate is serving from the Vercel standby" is sent when one request had to be answered by Vercel. The visitor never sees an error. Since 2026-11-02 the gate asks Oracle once more (400 ms later) for read-only requests, so a one-second blip (sslip.io DNS answering late = Cloudflare 530/1016) no longer triggers the switch or the message.

1. **Check first**: `GET <gate>/api/ops/oracle-status` shows the commit Oracle runs and `report_age_min`; `GET https://89-168-89-15.sslip.io/api/health` answers 200 when the site container is up. If both are fine, nothing needs doing: it was a blip.
2. **Merges that rebuild Oracle** are those touching `src/`, `public/`, `prisma/`, package files, `next.config.mjs`, `deploy/oracle/` or `deploy/hosting/`; docs-only and `.github/` changes do not. While it builds, the old container keeps serving and is replaced at the end (a few seconds). Batch changes into one merge, and avoid merging to `main` in the middle of a long Nova/Sham task (the updater waits up to 10 minutes for running tasks).
3. **Down for more than 15 minutes**: open `/admin` -> «🌐 الاستضافة» and choose Vercel only (the standby carries everything), then look at the server: `docker compose ps`, `docker compose logs --tail 100 site caddy` and the files `site_status` / `update.log` in the agent state folder. A failed build leaves the previous container running; the bot message says so.
4. **Disk**: the watchdog prunes Docker build cache at 75% and tells the owner at 90%; a full disk is the usual reason a rebuild fails.
5. After the cause is fixed, switch the gate back to Auto («تلقائي») so Oracle is tried first again.
6. The gate worker deploys from `main` (Workers Builds on `cloudflare/site-gate`); run `node cloudflare/site-gate/selftest.mjs` before merging a change to it.
