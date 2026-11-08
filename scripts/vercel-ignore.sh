#!/bin/sh
# Vercel ignoreCommand: exit 0 skips the build; exit 1 runs it.
# Be conservative: if Git cannot compare the deployed commit with its parent,
# or the diff is empty, build instead of silently leaving production stale.
# Preview deployments are intentionally skipped to conserve the Hobby build quota. NOTE: a skipped / cancelled preview STILL counts toward the free
# plan's 100 deployments per day; vercel.json (git.deploymentEnabled) switches whole branches off so they are never created at all.
[ "${VERCEL_ENV:-}" = "preview" ] && exit 0

# A merge commit's diff against its first parent shows only what the OTHER side brought: a merge that carries site changes could be skipped and production left stale
# (seen 2026-10-25: a merge that added one workflow file skipped a batch of src changes). A merge always builds.
[ "$(git rev-list --parents -n 1 HEAD 2>/dev/null | wc -w)" -gt 2 ] && exit 1
# Several commits pushed at once: compare with the last commit that was deployed, when Vercel tells us which one it was and we have it.
base="${VERCEL_GIT_PREVIOUS_SHA:-}"
if [ -n "$base" ] && git cat-file -e "$base^{commit}" 2>/dev/null; then
  changed_files="$(git diff --name-only "$base" HEAD 2>/dev/null)" || exit 1
else
  changed_files="$(git diff --name-only HEAD^ HEAD 2>/dev/null)" || exit 1
fi
[ -n "$changed_files" ] || exit 1

# Skip only when every changed file is in a deliberately excluded area (none of these is imported by the site: experiments/ = ModelScope Studio apps, e2e/ = tests,
# coder-sandbox/ = the Oracle runner). Every skipped commit saves a production build of the Hobby plan's 100 deployments per day.
# athar/web/lib is intentionally not excluded because the Vercel mirror imports it.
if printf '%s\n' "$changed_files" | grep -qvE '^(athar/(web/(app|components|special|Dockerfile|package(-lock)?\.json|next\.config\.mjs)|tests|contracts|scripts|viewer|[^/]+\.md)|cloudflare/|deploy/oracle/|contracts/|docs/|ai-system/|experiments/|e2e/|coder-sandbox/|media-bot/|supabase/|prisma/[^/]+\.sql$|\.github/|training/|scripts/(nova-eval|ops|tests|transplant)/|\.openhands/|hosting/|muse-spark/|CLAUDE\.md|AGENTS\.md)'; then
  must=1
fi
# every changed file is excluded -> skip; otherwise decide by the throttle below
[ "${must:-0}" = "0" ] && exit 0

# THROTTLE (2026-11-08): Vercel is only the standby now (Oracle serves first), but on 2026-10-29..11-04 the production branch received 27-236 commits a day and Vercel built
# 50-108 of them per day (free plan: 100 deployments/day and 6000 build minutes/month, "fair use" blocks the site with HTTP 402 when exceeded). A site commit builds only if the
# last deployed commit is at least THROTTLE_MIN minutes older, or the commit message carries [deploy], or it touches build-critical files. A skipped commit is picked up by
# the next commit after the window (the daily news commits guarantee one every few hours).
THROTTLE_MIN="${THROTTLE_MIN:-60}"
msg="$(git log -1 --format=%B HEAD 2>/dev/null)"
case "$msg" in *"[deploy]"*|*"[vercel]"*) exit 1;; esac
if printf '%s\n' "$changed_files" | grep -qE '^(vercel\.json|package(-lock)?\.json|next\.config\.mjs|prisma/schema\.prisma|scripts/vercel-ignore\.sh)$'; then exit 1; fi
if [ -n "$base" ] && git cat-file -e "$base^{commit}" 2>/dev/null; then
  t_base="$(git show -s --format=%ct "$base" 2>/dev/null)"; t_head="$(git show -s --format=%ct HEAD 2>/dev/null)"
  if [ -n "$t_base" ] && [ -n "$t_head" ] && [ $((t_head - t_base)) -lt $((THROTTLE_MIN * 60)) ] && [ $((t_head - t_base)) -ge 0 ]; then exit 0; fi
fi
exit 1

