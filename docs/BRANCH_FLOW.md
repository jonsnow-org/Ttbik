# One source branch, one deployment mirror / فرع مصدر واحد ومرآة نشر واحدة

## Branch roles
- `claude/free-services-marketplace-h6rwk2` is the protected default branch and canonical code source. Feature PRs target this branch.
- `main` is a deployment mirror consumed by the Oracle updater and the Cloudflare `site-gate` Workers Build. It is not an independent development branch.
- The Cloudflare gate routes users to Oracle first. Vercel follows the default branch as a standby when available; its status is not proof that Oracle is stale.
- `claude/free-services-marketplace-h6rwk2-squash` is not a deployment branch. Do not base work on it or push to it.

## Normal delivery flow
1. Create a feature branch from the current `claude/free-services-marketplace-h6rwk2`.
2. Open one focused PR targeting that branch. Merge only after CI passes.
3. After CI succeeds on the protected default branch, `.github/workflows/sync-main.yml` automatically fast-forwards `main` to the exact same commit.
4. The workflow verifies exact SHA parity, then waits for Oracle to report that commit and a healthy site build. Cloudflare Workers Builds also consume `main`.
5. Verify the sync workflow result and compare both refs. A successful mirror run means the code branches are aligned; Oracle confirmation means the primary site picked up the commit.

There is no routine manual `main -> production` sync PR. Do not land ordinary feature work directly on `main`.

## If a mismatch is detected
- If `main` is behind production, the mirror workflow fast-forwards it automatically after successful CI.
- If `main` contains a commit not present in production, the workflow fails without changing either ref. Review the main-only commit and open a recovery PR from `main` into `claude/free-services-marketplace-h6rwk2`; merge after CI, then the mirror can restore exact parity.
- Never force-push either deployment ref or create an automatic merge commit on only one branch to conceal divergence.
- After a merge, verify the branch comparison reports `identical` and the sync workflow confirms Oracle is healthy.

## Writing tests that behave the same everywhere
- A test that reads `process.env` (Studio URLs, tokens, flags) sets or deletes the variables it needs in `beforeEach` and restores them in `afterEach`, so it gives the same result on a laptop, on CI and in a merged tree.
- Tests of the same module in two sessions: add new `test(...)` blocks at the end of the file in separate commits, or use a new file; this avoids merge conflicts in the test file.

## Before and after a release
- Before: run the checks in `.github/workflows/ci.yml` that cover the files you touched.
- After: inspect CI, the mirror run, Oracle's confirmed commit, and the Cloudflare gate health. Do not infer production readiness from GitHub merge success alone.
- Batch work into one release PR when practical. Keep paid hosting out of the design.
- To pause the repair bots while you work, open an issue with the label `bots-pause` and close it afterwards.

---

# بالعربية (مختصر)
- فرع الإنتاج المحمي `claude/free-services-marketplace-h6rwk2` هو مصدر الكود الوحيد، وتُفتح طلبات الميزات عليه.
- `main` مرآة نشر آلية لـOracle وبوابة Cloudflare، وليست فرع تطوير مستقلاً.
- بعد نجاح CI، تحدّث مهمة `sync-main.yml` فرع `main` بالتقديم السريع، وتتحقق من تطابق البصمتين ومن تأكيد Oracle للبناء السليم.
- لا تنشئ طلب مزامنة يدوي من `main` إلى الإنتاج في المسار المعتاد، ولا تدفع تغييرات منفردة إلى `main`.
- إذا كان `main` متقدماً بتغييرات غير موجودة في الإنتاج، تتوقف المزامنة دون تعديل أي فرع؛ افتح طلب استعادة من `main` إلى فرع الإنتاج، ثم أعد المزامنة بعد نجاح CI.
- بعد كل دمج، تحقق من أن مقارنة الفرعين `identical` وأن Oracle أكد الالتزام نفسه.

---

## The Oracle path: what the alert means and what to do / مسار Oracle
"⚠️ Oracle is not answering; the gate is serving from the Vercel standby" is sent when one request had to be answered by Vercel. The visitor never sees an error. Since 2026-11-02 the message is sent only when failover requests keep coming for 3+ minutes (a deploy that replaces the site container takes seconds and no longer alerts; `failoverRun` in `src/lib/hostingOps.ts`), and the gate asks Oracle once more (400 ms later) for read-only requests, so a one-second blip (sslip.io DNS answering late = Cloudflare 530/1016) no longer triggers the switch or the message.

1. **Check first**: `GET <gate>/api/ops/oracle-status` shows the commit Oracle runs and `report_age_min`; `GET https://89-168-89-15.sslip.io/api/health` answers 200 when the site container is up. If both are fine, nothing needs doing: it was a blip.
2. **Merges that rebuild Oracle** are those touching `src/`, `public/`, `prisma/`, package files, `next.config.mjs`, `deploy/oracle/` or `deploy/hosting/`; docs-only and `.github/` changes do not. While it builds, the old container keeps serving and is replaced at the end (a few seconds). Batch changes into one merge, and avoid merging to `main` in the middle of a long Nova/Sham task (the updater waits up to 10 minutes for running tasks).
3. **Down for more than 15 minutes**: open `/admin` -> «🌐 الاستضافة» and choose Vercel only (the standby carries everything), then look at the server: `docker compose ps`, `docker compose logs --tail 100 site caddy` and the files `site_status` / `update.log` in the agent state folder. A failed build leaves the previous container running; the bot message says so.
4. **Disk**: the watchdog prunes Docker build cache at 75% and tells the owner at 90%; a full disk is the usual reason a rebuild fails.
5. After the cause is fixed, switch the gate back to Auto («تلقائي») so Oracle is tried first again.
6. The gate worker deploys from `main` (Workers Builds on `cloudflare/site-gate`); run `node cloudflare/site-gate/selftest.mjs` before merging a change to it.
