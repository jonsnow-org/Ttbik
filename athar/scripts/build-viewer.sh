#!/usr/bin/env bash
# Builds the standalone living-token viewer (one HTML file, no server needed) into athar/viewer/viewer.html and web/public/viewer.html.
set -euo pipefail
cd "$(dirname "$0")/.."
ES=$(ls web/node_modules/.bin/esbuild ../node_modules/.bin/esbuild node_modules/.bin/esbuild 2>/dev/null | head -1 || true)
[ -n "$ES" ] || { echo "esbuild not found"; exit 1; }
mkdir -p viewer web/public
"$ES" web/viewer/entry.ts --bundle --minify --format=iife --platform=browser --alias:crypto=./scripts/crypto-stub.js --outfile=viewer/viewer.js --log-level=warning
{
  printf '%s' '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Athar · أثر</title><style>html,body{margin:0;height:100%;background:#050914}#t{display:flex;align-items:center;justify-content:center;height:100%}#t svg{width:min(100vw,100vh);height:min(100vw,100vh)}</style></head><body><div id="t"></div><script>'
  cat viewer/viewer.js
  printf '%s' '</script></body></html>'
} > viewer/viewer.html
rm viewer/viewer.js
cp viewer/viewer.html web/public/viewer.html
wc -c viewer/viewer.html
