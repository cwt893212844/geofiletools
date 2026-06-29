import { rmSync } from 'node:fs';
import { join } from 'node:path';

const distGdal = join(process.cwd(), 'apps', 'web', 'dist', 'gdal');

for (const file of ['gdal3WebAssembly.wasm', 'gdal3WebAssembly.data']) {
  try {
    rmSync(join(distGdal, file));
    console.log(`[prepare-pages-dist] removed dist/gdal/${file}`);
  } catch {
    // already absent
  }
}
