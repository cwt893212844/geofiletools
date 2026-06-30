import { brotliCompressSync } from 'node:zlib';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const distGdal = join(process.cwd(), 'apps', 'web', 'dist', 'gdal');
const wasmPath = join(distGdal, 'gdal3WebAssembly.wasm');

const raw = readFileSync(wasmPath);
const compressed = brotliCompressSync(raw);
writeFileSync(wasmPath, compressed);

const rawMb = (raw.length / 1024 / 1024).toFixed(2);
const brMb = (compressed.length / 1024 / 1024).toFixed(2);
console.log(`[prepare-pages-dist] brotli gdal wasm ${rawMb} MiB → ${brMb} MiB (same-origin, Content-Encoding: br)`);

const dataPath = join(distGdal, 'gdal3WebAssembly.data');
const dataMb = (statSync(dataPath).size / 1024 / 1024).toFixed(2);
console.log(`[prepare-pages-dist] kept gdal data ${dataMb} MiB`);
