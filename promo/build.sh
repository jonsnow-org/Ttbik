#!/usr/bin/env bash
# Builds the vertical (1080x1920) Sham AI promo video + slide images into $1.
set -euo pipefail
OUT="${1:-out}"
mkdir -p "$OUT"
python3 "$(dirname "$0")/render.py" "$OUT"
ffmpeg -v error -y \
  -loop 1 -t 5.6 -i "$OUT/s1.png" -loop 1 -t 5.6 -i "$OUT/s2.png" \
  -loop 1 -t 5.6 -i "$OUT/s3.png" -loop 1 -t 5.6 -i "$OUT/s4.png" \
  -f lavfi -t 21 -i anullsrc=r=44100:cl=mono \
  -filter_complex "[0][1]xfade=transition=fade:duration=0.6:offset=5[a];[a][2]xfade=transition=fade:duration=0.6:offset=10[b];[b][3]xfade=transition=fade:duration=0.6:offset=15[v]" \
  -map "[v]" -map 4:a -r 15 -c:v libx264 -preset veryslow -tune stillimage -crf 34 -pix_fmt yuv420p \
  -c:a aac -b:a 24k -shortest -movflags +faststart "$OUT/sham-ai-promo.mp4"
ls -la "$OUT"
