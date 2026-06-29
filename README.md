# GeoFileTools

Browser-side GIS vector file converter. Files are processed locally — nothing is uploaded to a server.

## Stack

- Astro 7 + React + Tailwind v4 (`apps/web`)
- `@gis-tools/core` — gdal3.js, shpjs, DWG, KML/GPX, coordinate transforms

## Development

```bash
npm install
npm run dev    # http://localhost:4321
npm test
npm run build
```

## Deploy (Cloudflare Pages)

| Setting | Value |
|---------|-------|
| Build command | `npm run build` |
| Build output | `apps/web/dist` |
| Node version | `22` |

`wrangler.toml` in the repo root mirrors these settings for Git-connected Pages projects.
