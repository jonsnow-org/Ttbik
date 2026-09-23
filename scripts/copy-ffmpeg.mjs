// Keeps public/ffmpeg in sync with the installed @ffmpeg/ffmpeg version.
// See AudioVisualizerStudio.tsx (loadFfmpeg) for why these files are served
// from public/ instead of going through the bundler.
import { cpSync, mkdirSync, readdirSync } from "node:fs";
const src = "node_modules/@ffmpeg/ffmpeg/dist/esm";
const dest = "public/ffmpeg";
mkdirSync(dest, { recursive: true });
for (const f of readdirSync(src)) if (f.endsWith(".js")) cpSync(`${src}/${f}`, `${dest}/${f}`);
