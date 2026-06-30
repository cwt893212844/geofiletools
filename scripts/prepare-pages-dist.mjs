import { brotliCompressSync } from 'node:zlib';
import { readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const distGdal = join(process.cwd(), 'apps', 'web', 'dist', 'gdal');
const wasmPath = join(distGdal, 'gdal3WebAssembly.wasm');
const brPath = join(distGdal, 'gdal3WebAssembly.wasm.br');

const raw = readFileSync(wasmPath);
const compressed = brotliCompressSync(raw);
writeFileSync(brPath, compressed);
rmSync(wasmPath);

const rawMb = (raw.length / 1024 / 1024).toFixed(2);
const brMb = (compressed.length / 1024 / 1024).toFixed(2);
console.log(`[prepare-pages-dist] gdal wasm ${rawMb} MiB → ${brPath} ${brMb} MiB`);

const dataPath = join(distGdal, 'gdal3WebAssembly.data');
const dataMb = (statSync(dataPath).size / 1024 / 1024).toFixed(2);
console.log(`[prepare-pages-dist] kept gdal data ${dataMb} MiB`);
