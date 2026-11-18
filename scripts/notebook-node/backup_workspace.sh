#!/usr/bin/env bash
# Owner's order 2026-11-18: the modelscope.ai CPU notebook stays stopped from now on; everything it held moves to Studios. This runs ON the notebook (notebook-task.yml, target=notebook)
# while a session is alive: inventory of /mnt/workspace and /mnt/data, then every item that cannot be rebuilt is packed (tar, cut into 1.9 GB parts) and uploaded to the PRIVATE
# ModelScope model repo $BACKUP_REPO on the international account, with a manifest of sizes and sha256. backup_upload.py verifies each part against the hash the hub reports.
# The Studio sham-runner-1 (ai-system/modelscope-runner/app.py) restores the same manifest into its own /mnt/workspace.
# Skipped on purpose: m/ (the Nova 2 GGUF, Studio 16 downloads it from ModelScope itself), llama.cpp (rebuildable), runner*/ (GitHub runner binaries + this machine's credentials), tmp, caches.
# ARGS: "inventory" = list only; "upload" (default) = inventory + upload. Needs MS_AI_TOKEN (secret MODELSCOPE_AI_TOKEN). Never prints it.
set -uo pipefail
MODE=${1:-upload}
BACKUP_REPO=${BACKUP_REPO:-Jonjithup/sham-notebook-workspace}
MAX_GB=${MAX_GB:-15}                        # any single item bigger than this is reported and skipped (not silently)
SKIP=" m llama.cpp runner runner2 runner3 tmp .cache lost+found __pycache__ "
echo "== host $(hostname)  $(date -u +%FT%TZ)"; df -h /mnt/workspace /mnt/data /tmp 2>/dev/null
for R in /mnt/workspace /mnt/data; do
  [ -d "$R" ] || { echo "== $R: missing"; continue; }
  echo "== $R"; du -sh "$R"/* "$R"/.[!.]* 2>/dev/null | sort -h
  echo "-- $R depth 2"; du -h --max-depth=2 "$R" 2>/dev/null | sort -h | tail -n 40
done
[ "$MODE" = "inventory" ] && exit 0
[ -n "${MS_AI_TOKEN:-}" ] || { echo "::error::MS_AI_TOKEN missing"; exit 1; }
pip install -q -U modelscope >/dev/null 2>&1 || true
# scratch space: the disk with the most free room (parts are deleted after each item)
S=$(for d in /mnt/data /mnt/workspace /tmp; do [ -w "$d" ] && echo "$(df -Pk "$d" | awk 'NR==2{print $4}') $d"; done | sort -n | tail -1 | cut -d' ' -f2)
S=$S/.nb_backup_parts; rm -rf "$S"; mkdir -p "$S"; echo "scratch $S"
LIST=$S/../.nb_backup_items; : > "$LIST"
for R in /mnt/workspace /mnt/data; do
  [ -d "$R" ] || continue
  for p in "$R"/* "$R"/.[!.]*; do
    [ -e "$p" ] || continue; b=$(basename "$p")
    case "$SKIP" in *" $b "*) echo "skip $p (rebuildable / not data)"; continue;; esac
    case "$p" in "$S"|"$S"/..*|*/.nb_backup_parts|*/.nb_backup_items) continue;; esac
    case "$b" in *.gguf|*.safetensors) [ "$R" = /mnt/workspace ] && { echo "skip $p (model weights already on ModelScope)"; continue; };; esac
    kb=$(du -sk "$p" | cut -f1)
    if [ "$kb" -gt $((MAX_GB*1024*1024)) ]; then echo "::warning::NOT backed up (bigger than ${MAX_GB} GB): $p $((kb/1024)) MB"; continue; fi
    echo "$R|$b|$kb" >> "$LIST"
  done
done
echo "== items to back up"; cat "$LIST"
fail=0
while IFS='|' read -r R b kb; do
  key=$( [ "$R" = /mnt/data ] && echo "data__$b" || echo "$b" ); key=${key// /_}
  echo "== pack $R/$b ($((kb/1024)) MB) as $key"
  rm -f "$S"/*
  tar -C "$R" --exclude=__pycache__ -cf - "$b" 2>"$S/../tar.err" | tee >(sha256sum | cut -d' ' -f1 > "$S/$key.sha") | split -b 1900M -d -a 3 - "$S/$key.tar.part-"
  sleep 2; tail -n 3 "$S/../tar.err"
  python3 "$(dirname "$0")/backup_upload.py" upload "$BACKUP_REPO" "$S" "$key" "$R/$b" || fail=1
  rm -f "$S"/*
done < "$LIST"
rm -rf "$S"
python3 "$(dirname "$0")/backup_upload.py" verify "$BACKUP_REPO" || fail=1
exit $fail
