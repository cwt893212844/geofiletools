import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const libredwgWasm = join(root, 'node_modules', '@mlightcad', 'libredwg-web', 'wasm');
const target = join(root, 'apps', 'web', 'public', 'libredwg');

if (!existsSync(libredwgWasm)) {
  console.warn('[copy-dwg-wasm-assets] @mlightcad/libredwg-web not installed yet, skipping.');
  process.exit(0);
}

mkdirSync(target, { recursive: true });
for (const file of ['libredwg-web.js', 'libredwg-web.wasm']) {
  cpSync(join(libredwgWasm, file), join(target, file), { force: true });
}
console.log('[copy-dwg-wasm-assets] LibreDWG WASM copied to apps/web/public/libredwg');
