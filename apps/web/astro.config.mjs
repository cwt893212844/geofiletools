// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://geofiletools.com',
  integrations: [react(), sitemap()],
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        buffer: 'buffer',
      },
    },
    define: {
      global: 'globalThis',
    },
    optimizeDeps: {
      include: ['buffer', 'jszip'],
      exclude: [
        'gdal3.js',
        '@gis-tools/core',
        '@cadview/dwg',
        '@cadview/core',
        '@mlightcad/libredwg-web',
      ],
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (
              id.includes('packages/gis-core') ||
              id.includes('@gis-tools/core') ||
              id.includes('node_modules/jszip')
            ) {
              return 'gis-core';
            }
            if (id.includes('@cadview/dwg') || id.includes('@mlightcad/libredwg-web')) {
              return 'dwg-wasm';
            }
            if (id.includes('node_modules/gdal3.js')) {
              return 'gdal3';
            }
          },
        },
      },
    },
    server: {
      fs: {
        allow: ['../..'],
      },
    },
  },
});
