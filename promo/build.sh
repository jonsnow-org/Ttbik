#!/usr/bin/env bash
# Builds the vertical (1080x1920) Sham AI promo video + slide images into $1.
set -euo pipefail
OUT="${1:-out}"
mkdir -p "$OUT"
python3 "$(dirname "$0")/render.py" "$OUT"
ffmpeg -v error -y \
  -loop 1 -t 5.6 -i "$OUT/s1.png" -loop 1 -t 5.6 -i "$OUT/s2.png" \
  -loop 1 -t 5.6 -i "$OUT/s3.png" -loop 1 -t 5.6 -i "$OUT/s4.png" \
  -f lavfi -t 21 -i "aevalsrc=0.10*sin(2*PI*220*t)+0.07*sin(2*PI*261.63*t)+0.07*sin(2*PI*329.63*t)+0.05*sin(2*PI*440*t)*(0.5+0.5*sin(2*PI*0.25*t)):s=44100" \
  -filter_complex "[0][1]xfade=transition=fade:duration=0.6:offset=5[a];[a][2]xfade=transition=fade:duration=0.6:offset=10[b];[b][3]xfade=transition=fade:duration=0.6:offset=15,fade=t=in:st=0:d=0.5,fade=t=out:st=20:d=0.7[v];[4]volume=0.6,tremolo=f=2:d=0.2,afade=t=in:st=0:d=1.5,afade=t=out:st=19:d=1.7[au]" \
  -map "[v]" -map "[au]" -r 30 -c:v libx264 -preset slow -tune stillimage -crf 22 -pix_fmt yuv420p \
  -c:a aac -b:a 128k -shortest -movflags +faststart "$OUT/sham-ai-promo.mp4"
ls -la "$OUT"
