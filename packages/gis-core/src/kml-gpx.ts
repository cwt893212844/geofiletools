import JSZip from 'jszip';
import { kml, gpx } from '@tmcw/togeojson';
import { convert } from './gdal-service';

function readFileAsText(file: File): Promise<string> {
  return file.text();
}

async function readKmz(file: File): Promise<string> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const kmlEntry =
    Object.values(zip.files).find((entry) => !entry.dir && entry.name.toLowerCase().endsWith('.kml')) ??
    Object.values(zip.files).find((entry) => !entry.dir);

  if (!kmlEntry) {
    throw new Error('KMZ archive does not contain a KML file.');
  }

  return kmlEntry.async('text');
}

/**
 * Recursively explode a GeometryCollection into its leaf geometries so that
 * each sub-geometry becomes its own GeoJSON Feature. This prevents viewers
 * from drawing connecting lines between sub-geometry endpoints.
 */
function explodeGeometry(
  geometry: GeoJSON.Geometry,
  properties: GeoJSON.Feature['properties'],
  out: GeoJSON.Feature[],
): void {
  if (geometry.type === 'GeometryCollection') {
    for (const sub of geometry.geometries) {
      explodeGeometry(sub, properties, out);
    }
  } else {
    out.push({ type: 'Feature', geometry, properties });
  }
}

function explodeGeometryCollections(
  collection: GeoJSON.FeatureCollection,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const feature of collection.features) {
    if (feature.geometry?.type === 'GeometryCollection') {
      explodeGeometry(feature.geometry, feature.properties, features);
    } else {
      features.push(feature);
    }
  }
  return { type: 'FeatureCollection', features };
}

/**
 * Convert closed LineStrings to Polygons. Many CAD-exported KML files represent
 * closed polylines as LineStrings with first==last coordinate. When rendered as
 * lines, they appear connected end-to-end and messy. Converting to Polygon fixes this.
 */
function closedLineStringsToPolygons(
  collection: GeoJSON.FeatureCollection,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const feature of collection.features) {
    if (feature.geometry?.type === 'LineString') {
      const coords = feature.geometry.coordinates as number[][];
      if (coords.length >= 4) {
        const first = coords[0];
        const last = coords[coords.length - 1];
        if (first[0] === last[0] && first[1] === last[1]) {
          // Closed LineString → Polygon
          features.push({
            ...feature,
            geometry: {
              type: 'Polygon',
              coordinates: [coords],
            },
          });
          continue;
        }
      }
    }
    features.push(feature);
  }
  return { type: 'FeatureCollection', features };
}

export async function kmlOrKmzToGeoJSON(file: File): Promise<GeoJSON.FeatureCollection> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  const text = ext === 'kmz' ? await readKmz(file) : await readFileAsText(file);
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  const exploded = explodeGeometryCollections(kml(doc));
  return closedLineStringsToPolygons(exploded);
}

export async function gpxToGeoJSON(file: File): Promise<GeoJSON.FeatureCollection> {
  const text = await readFileAsText(file);
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  return gpx(doc);
}

export async function geoJSONToKml(
  geojson: GeoJSON.FeatureCollection,
  sourceCrs?: string,
): Promise<Blob> {
  const file = new File([JSON.stringify(geojson)], 'input.geojson', {
    type: 'application/geo+json',
  });
  return convert([file], {
    outputFormat: 'KML',
    targetCrs: 'EPSG:4326',
    sourceCrs,
  });
}

export async function geoJSONToGpx(geojson: GeoJSON.FeatureCollection): Promise<Blob> {
  const file = new File([JSON.stringify(geojson)], 'input.geojson', {
    type: 'application/geo+json',
  });
  return convert([file], { outputFormat: 'GPX' });
}

export async function kmlOrGpxFileToGeoJSONBlob(file: File): Promise<Blob> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  const collection =
    ext === 'gpx' ? await gpxToGeoJSON(file) : await kmlOrKmzToGeoJSON(file);
  return new Blob([JSON.stringify(collection)], { type: 'application/geo+json' });
}
