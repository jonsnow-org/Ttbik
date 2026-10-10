#!/bin/sh
# Vercel "ignoreCommand": exit 0 = skip this build, exit 1 = build. Lives in a file because vercel.json limits ignoreCommand to 256 characters.
# Skips builds when every changed file is Athar-only (app/tests/docs), Oracle/Cloudflare, docs, or Sham-only (ai-system, sham workflows).
# athar/web/lib is NOT in the list on purpose: the Vercel mirror imports it.
if git diff --name-only HEAD^ HEAD | grep -qvE '^(athar/(web/(app|components|special|Dockerfile|package(-lock)?\.json|next\.config\.mjs)|tests|contracts|scripts|viewer|[^/]+\.md)|cloudflare/|deploy/oracle/|docs/|ai-system/|\.github/workflows/sham-|scripts/vercel-ignore\.sh|CLAUDE\.md|AGENTS\.md)'; then exit 1; fi
exit 0
