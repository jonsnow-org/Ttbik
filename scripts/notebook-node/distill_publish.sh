#!/usr/bin/env bash
# Turns the owner's chat-app export (put in /mnt/workspace/inbox by uploading it in the notebook's file explorer) into Sham's teacher pool:
# import (filters private data) -> private Kaggle dataset <account>/distill-teacher-records -> every Sham trainer reads it through sham_sil_bridge.teacher_pairs.
# Run by the notebook runner (notebook-task.yml, script distill_publish.sh); needs KAGGLE_USERNAME and KAGGLE_API_TOKEN from the repository secrets. Nothing is printed except counts.
set -eu
W=${W:-/mnt/workspace}; IN=${INBOX:-$W/inbox}; OUT=$W/teacher_pool; mkdir -p "$OUT" "$IN"
f=$(ls -t "$IN"/*.zip "$IN"/*.json "$IN"/*.jsonl 2>/dev/null | head -1 || true)
[ -n "$f" ] || { echo "no export found in $IN (upload conversations.json or the export zip there)"; exit 1; }
echo "importing $(basename "$f")"
python3 ai-system/distill/import_chat_export.py "$f" "$OUT/records.jsonl" --source "${SOURCE:-chatgpt-export}"
printf '{"title":"distill-teacher-records","id":"%s/distill-teacher-records","licenses":[{"name":"other"}],"isPrivate":true}\n' "$KAGGLE_USERNAME" > "$OUT/dataset-metadata.json"
pip -q install kaggle 2>&1 | tail -1
kaggle datasets create -p "$OUT" 2>&1 | sed 's/\(token\|key\)[^ ]*/\1 ***/Ig' || kaggle datasets version -p "$OUT" -m "update $(date -u +%F)" 2>&1 | tail -3
echo "records: $(wc -l < "$OUT/records.jsonl")"
