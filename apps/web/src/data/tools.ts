export interface ToolLink {
  title: string;
  href: string;
  description: string;
  category: 'convert' | 'tools';
}

export const siteConfig = {
  name: 'GeoFileTools',
  tagline: 'Free browser-based GIS vector converters',
  description:
    'Convert DXF, DWG, Shapefile, GeoJSON, KML, and GPX online. Files are processed locally in your browser — nothing is uploaded.',
  url: 'https://geofiletools.example.com',
};

export const convertTools: ToolLink[] = [
  {
    title: 'DXF to Shapefile',
    href: '/convert/dxf-to-shp',
    description: 'Convert AutoCAD DXF drawings to ESRI Shapefile (.zip).',
    category: 'convert',
  },
  {
    title: 'DXF to GeoJSON',
    href: '/convert/dxf-to-geojson',
    description: 'Convert DXF to web-friendly GeoJSON with map preview.',
    category: 'convert',
  },
  {
    title: 'DWG to Shapefile',
    href: '/convert/dwg-to-shp',
    description: 'Convert AutoCAD DWG to Shapefile in your browser.',
    category: 'convert',
  },
  {
    title: 'DWG to GeoJSON',
    href: '/convert/dwg-to-geojson',
    description: 'Convert DWG CAD files to GeoJSON for QGIS or Leaflet.',
    category: 'convert',
  },
  {
    title: 'Shapefile to GeoJSON',
    href: '/convert/shp-to-geojson',
    description: 'Convert .shp (+ sidecars or zip) to GeoJSON instantly.',
    category: 'convert',
  },
  {
    title: 'GeoJSON to Shapefile',
    href: '/convert/geojson-to-shp',
    description: 'Package GeoJSON as a downloadable Shapefile zip.',
    category: 'convert',
  },
  {
    title: 'KML to GeoJSON',
    href: '/convert/kml-to-geojson',
    description: 'Convert Google Earth KML/KMZ to GeoJSON.',
    category: 'convert',
  },
  {
    title: 'GPX to GeoJSON',
    href: '/convert/gpx-to-geojson',
    description: 'Convert GPS GPX tracks and waypoints to GeoJSON.',
    category: 'convert',
  },
  {
    title: 'GeoJSON to GeoPackage',
    href: '/convert/geojson-to-gpkg',
    description: 'Convert GeoJSON to a single .gpkg file for modern GIS workflows.',
    category: 'convert',
  },
  {
    title: 'GeoJSON to KML',
    href: '/convert/geojson-to-kml',
    description: 'Export GeoJSON as KML for Google Earth.',
    category: 'convert',
  },
];

export const utilityTools: ToolLink[] = [
  {
    title: 'GeoJSON Viewer',
    href: '/tools/geojson-viewer',
    description: 'Preview GeoJSON or Shapefile on an interactive map.',
    category: 'tools',
  },
  {
    title: 'Coordinate Converter',
    href: '/tools/coordinate-converter',
    description: 'Transform WGS84 lat/lon and UTM coordinates.',
    category: 'tools',
  },
];

export const allTools = [...convertTools, ...utilityTools];
