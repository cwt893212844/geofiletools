import { gzipSync } from 'node:zlib';
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const distGdal = join(process.cwd(), 'apps', 'web', 'dist', 'gdal');
const wasmPath = join(distGdal, 'gdal3WebAssembly.wasm');
const gzPath = join(distGdal, 'gdal3WebAssembly.wasm.gz');

if (!existsSync(wasmPath)) {
  if (existsSync(gzPath)) {
    const gzMb = (statSync(gzPath).size / 1024 / 1024).toFixed(2);
    console.log(`[prepare-pages-dist] already prepared (${gzPath} ${gzMb} MiB), skipping`);
    process.exit(0);
  }
  console.error(`[prepare-pages-dist] missing ${wasmPath}`);
  console.error('Run `npm run build -w apps/web` first (or ensure postinstall copied GDAL assets).');
  process.exit(1);
}

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
