import {
  detectGeoJsonCrs,
  looksLikeGeographic,
  reprojectFeatureCollection,
} from './coordinate';

type ScalarProperty = string | number | boolean | null;

export function parseGeoJsonCollection(text: string): GeoJSON.FeatureCollection {
  const data = JSON.parse(text) as GeoJSON.GeoJSON & {
    attributes?: Record<string, unknown>;
  };

  if (data.type === 'FeatureCollection') {
    return data;
  }
  if (data.type === 'Feature') {
    return { type: 'FeatureCollection', features: [data] };
  }
  throw new Error('GeoJSON must be a FeatureCollection or Feature.');
}

function sanitizeFieldName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_\u4e00-\u9fff]/g, '_').replace(/^(\d)/, '_$1');
  return (cleaned || 'field').slice(0, 63);
}

/** Flatten nested objects/arrays so GDAL/GPKG keeps every attribute as a column. */
function flattenProperties(
  obj: Record<string, unknown>,
  prefix = '',
): Record<string, ScalarProperty> {
  const out: Record<string, ScalarProperty> = {};

  for (const [key, value] of Object.entries(obj)) {
    const name = sanitizeFieldName(prefix ? `${prefix}_${key}` : key);

    if (value === null || value === undefined) {
      out[name] = null;
    } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[name] = value;
    } else {
      out[name] = JSON.stringify(value);
    }
  }

  return out;
}

function featureProperties(feature: GeoJSON.Feature): Record<string, unknown> {
  const withArcGis = feature as GeoJSON.Feature & { attributes?: Record<string, unknown> };
  const base = feature.properties ?? withArcGis.attributes ?? {};
  if (feature.id != null && base.id == null) {
    return { ...base, id: feature.id };
  }
  return base;
}

/** Normalize GeoJSON before GDAL ogr2ogr — keeps attributes GPKG/SQLite can store. */
export function prepareGeoJsonForOgr(collection: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: collection.features
      .filter((feature) => feature.geometry != null)
      .map((feature) => ({
        type: 'Feature' as const,
        geometry: feature.geometry!,
        properties: flattenProperties(featureProperties(feature)),
      })),
  };
}

/** Reproject to WGS84 when needed so OpenLayers map preview can fit the extent. */
export function prepareGeoJsonForPreview(
  collection: GeoJSON.FeatureCollection,
  sourceCrs?: string,
): GeoJSON.FeatureCollection {
  if (looksLikeGeographic(collection)) {
    return collection;
  }
  if (!sourceCrs) {
    return collection;
  }
  try {
    return reprojectFeatureCollection(collection, sourceCrs);
  } catch {
    return collection;
  }
}

export function geoJsonCollectionToFile(
  collection: GeoJSON.FeatureCollection,
  name = 'input.geojson',
): File {
  return new File([JSON.stringify(collection)], name, { type: 'application/geo+json' });
}

export function prepareGeoJsonInput(text: string): {
  collection: GeoJSON.FeatureCollection;
  ogrCollection: GeoJSON.FeatureCollection;
  sourceCrs?: string;
  ogrFile: File;
  previewText: string;
} {
  const collection = parseGeoJsonCollection(text);
  const sourceCrs = detectGeoJsonCrs(collection);
  const ogrCollection = prepareGeoJsonForOgr(collection);
  const forPreview = prepareGeoJsonForPreview(ogrCollection, sourceCrs);

  return {
    collection,
    ogrCollection,
    sourceCrs,
    ogrFile: geoJsonCollectionToFile(ogrCollection),
    previewText: JSON.stringify(forPreview),
  };
}
