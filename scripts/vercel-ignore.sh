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

# Skip only when every changed file is in a deliberately excluded area.
# athar/web/lib is intentionally not excluded because the Vercel mirror imports it.
if printf '%s\n' "$changed_files" | grep -qvE '^(athar/(web/(app|components|special|Dockerfile|package(-lock)?\.json|next\.config\.mjs)|tests|contracts|scripts|viewer|[^/]+\.md)|cloudflare/|deploy/oracle/|contracts/|docs/|ai-system/|media-bot/|supabase/|prisma/[^/]+\.sql$|\.github/|training/|scripts/nova-eval/|CLAUDE\.md|AGENTS\.md)'; then
  exit 1
fi
exit 0
