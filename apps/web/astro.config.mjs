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
    optimizeDeps: {
      include: ['jszip'],
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
            if (id.includes('@cadview/dwg') || id.includes('@mlightcad/libredwg-web')) {
              return 'dwg-wasm';
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
