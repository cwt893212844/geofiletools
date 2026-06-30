import { gzipSync } from 'node:zlib';
import { readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const distGdal = join(process.cwd(), 'apps', 'web', 'dist', 'gdal');
const wasmPath = join(distGdal, 'gdal3WebAssembly.wasm');
const gzPath = join(distGdal, 'gdal3WebAssembly.wasm.gz');

const raw = readFileSync(wasmPath);
const compressed = gzipSync(raw, { level: 9 });
writeFileSync(gzPath, compressed);
rmSync(wasmPath);

// Remove legacy brotli sidecar if a prior deploy left it in dist.
try {
  rmSync(join(distGdal, 'gdal3WebAssembly.wasm.br'));
} catch {
  // absent
}

const rawMb = (raw.length / 1024 / 1024).toFixed(2);
const gzMb = (compressed.length / 1024 / 1024).toFixed(2);
console.log(`[prepare-pages-dist] gdal wasm ${rawMb} MiB → ${gzPath} ${gzMb} MiB`);

const dataPath = join(distGdal, 'gdal3WebAssembly.data');
const dataMb = (statSync(dataPath).size / 1024 / 1024).toFixed(2);
console.log(`[prepare-pages-dist] kept gdal data ${dataMb} MiB`);
