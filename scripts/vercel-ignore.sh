#!/bin/sh
# Vercel ignoreCommand: exit 0 skips the build; exit 1 runs it.
# Be conservative: if Git cannot compare the deployed commit with its parent,
# or the diff is empty, build instead of silently leaving production stale.
# Preview deployments are intentionally skipped to conserve the Hobby build quota.
[ "${VERCEL_ENV:-}" = "preview" ] && exit 0

changed_files="$(git diff --name-only HEAD^ HEAD 2>/dev/null)" || exit 1
[ -n "$changed_files" ] || exit 1

# Skip only when every changed file is in a deliberately excluded area.
# athar/web/lib is intentionally not excluded because the Vercel mirror imports it.
if printf '%s\n' "$changed_files" | grep -qvE '^(athar/(web/(app|components|special|Dockerfile|package(-lock)?\.json|next\.config\.mjs)|tests|contracts|scripts|viewer|[^/]+\.md)|cloudflare/|deploy/oracle/|contracts/|docs/|ai-system/|media-bot/|supabase/|prisma/[^/]+\.sql$|\.github/workflows/sham-|CLAUDE\.md|AGENTS\.md)'; then
  exit 1
fi
exit 0
