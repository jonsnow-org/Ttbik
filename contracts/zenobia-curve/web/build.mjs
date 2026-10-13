import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const here = path.dirname(fileURLToPath(import.meta.url));
const shim = path.join(here, 'src/buffer-shim.js');
for (const name of ['trade', 'launch', 'create', 'coins']) {
  await build({
    entryPoints: [path.join(here, `src/${name}.ts`)],
    bundle: true, minify: true, format: 'iife', target: 'es2020',
    outfile: path.join(here, `../../../public/zenobia/znbt/${name}.js`),
    loader: { '.svg': 'text', '.webp': 'binary' },
    inject: [shim],
    define: { global: 'window', 'process.env.NODE_ENV': '"production"' },
    alias: { '@ton/core': path.join(here, 'node_modules/@ton/core'), '@ton/crypto': path.join(here, 'node_modules/@ton/crypto') },
  });
}
