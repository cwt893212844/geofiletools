import type { GdalPaths } from '@gis-tools/core';

const GDAL_CDN_BASE = 'https://cdn.jsdelivr.net/npm/gdal3.js@2.8.1/dist/package';

const LOCAL_GDAL_PATHS: GdalPaths = {
  js: '/gdal/gdal3.js',
  wasm: '/gdal/gdal3WebAssembly.wasm',
  data: '/gdal/gdal3WebAssembly.data',
};

const CDN_GDAL_PATHS: GdalPaths = {
  js: `${GDAL_CDN_BASE}/gdal3.js`,
  wasm: `${GDAL_CDN_BASE}/gdal3WebAssembly.wasm`,
  data: `${GDAL_CDN_BASE}/gdal3WebAssembly.data`,
};

/** Production builds use jsDelivr — Cloudflare Pages caps single assets at 25 MiB. */
export const GDAL_PATHS: GdalPaths = import.meta.env.PROD ? CDN_GDAL_PATHS : LOCAL_GDAL_PATHS;
