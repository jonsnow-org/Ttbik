#!/bin/sh
# Full free pipeline for one episode (run from promo/remotion). Expects episode.json.
set -e
SITE=$(python3 -c "import json;print(json.load(open('episode.json'))['site'])")
P=$(python3 -c "import json;print(json.load(open('episode.json'))['path'])")
IN=$(python3 -c "import json;print(json.load(open('episode.json'))['input'])")
TXT=$(python3 -c "import json;print(json.load(open('episode.json'))['script'])")
VOICE=$(python3 -c "import json;print(json.load(open('episode.json'))['voice'])")
LANGV=$(python3 -c "import json;print(json.load(open('episode.json')).get('lang','ar'))")
RATE=$(python3 -c "import json;print(json.load(open('episode.json'))['rate'])")
mkdir -p out rec
node scripts/record.mjs "$SITE" "$P" "$IN" rec "$LANGV"
# drop the blank first ~1.5s of page load, encode to h264 for Remotion
ffmpeg -y -loglevel error -ss 1.5 -i rec/screen.webm -vf "fps=30,scale=720:1280:flags=lanczos" -c:v libx264 -pix_fmt yuv420p -crf 18 -an public/screen.mp4
python3 scripts/tts.py "$TXT" "$VOICE" "$RATE" public
sh scripts/music.sh
python3 scripts/finalize_words.py
npx remotion render Promo out/promo.mp4 --props=props.json
npx remotion still Promo out/thumb.jpg --props=props.json --frame=75
