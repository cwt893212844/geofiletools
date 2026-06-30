import type { GdalPaths } from '@gis-tools/core';

/** Same-origin GDAL assets; production wasm is brotli-precompressed (see prepare-pages-dist.mjs). */
export const GDAL_PATHS: GdalPaths = {
  js: '/gdal/gdal3.js',
  wasm: '/gdal/gdal3WebAssembly.wasm',
  data: '/gdal/gdal3WebAssembly.data',
};
