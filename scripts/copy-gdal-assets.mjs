import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const gdalPkg = join(root, 'node_modules', 'gdal3.js', 'dist', 'package');
const target = join(root, 'apps', 'web', 'public', 'gdal');

if (!existsSync(gdalPkg)) {
  console.warn('[copy-gdal-assets] gdal3.js not installed yet, skipping.');
  process.exit(0);
}

mkdirSync(target, { recursive: true });
for (const file of ['gdal3.js', 'gdal3WebAssembly.wasm', 'gdal3WebAssembly.data']) {
  cpSync(join(gdalPkg, file), join(target, file), { force: true });
}
console.log('[copy-gdal-assets] GDAL WASM assets copied to apps/web/public/gdal');
