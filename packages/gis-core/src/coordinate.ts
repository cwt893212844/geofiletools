import proj4 from 'proj4';

proj4.defs('EPSG:4326', '+proj=longlat +datum=WGS84 +no_defs +type=crs');
proj4.defs('EPSG:4490', '+proj=longlat +ellps=GRS80 +no_defs +type=crs');
proj4.defs(
  'EPSG:3857',
  '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs +type=crs',
);

for (let zone = 1; zone <= 60; zone += 1) {
  const north = 32600 + zone;
  const south = 32700 + zone;
  proj4.defs(`EPSG:${north}`, `+proj=utm +zone=${zone} +datum=WGS84 +units=m +no_defs +type=crs`);
  proj4.defs(`EPSG:${south}`, `+proj=utm +zone=${zone} +south +datum=WGS84 +units=m +no_defs +type=crs`);
}

export interface CoordinatePair {
  x: number;
  y: number;
}

export interface CoordinateConversionResult {
  from: { crs: string; coordinates: CoordinatePair };
  to: { crs: string; coordinates: CoordinatePair };
}

export function transformCoordinates(
  coordinates: CoordinatePair,
  fromCrs: string,
  toCrs: string,
): CoordinateConversionResult {
  const [x, y] = proj4(fromCrs, toCrs, [coordinates.x, coordinates.y]);
  return {
    from: { crs: fromCrs, coordinates },
    to: { crs: toCrs, coordinates: { x, y } },
  };
}

export function wgs84ToUtm(lat: number, lon: number): CoordinateConversionResult {
  const zone = Math.floor((lon + 180) / 6) + 1;
  const epsg = lat >= 0 ? 32600 + zone : 32700 + zone;
  return transformCoordinates({ x: lon, y: lat }, 'EPSG:4326', `EPSG:${epsg}`);
}

export function utmToWgs84(easting: number, northing: number, zone: number, northern = true): CoordinateConversionResult {
  const epsg = northern ? 32600 + zone : 32700 + zone;
  return transformCoordinates({ x: easting, y: northing }, `EPSG:${epsg}`, 'EPSG:4326');
}

export const COMMON_CRS = [
  { code: 'EPSG:4326', label: 'WGS 84 (lat/lon)' },
  { code: 'EPSG:3857', label: 'Web Mercator' },
  ...Array.from({ length: 60 }, (_, index) => {
    const zone = index + 1;
    return { code: `EPSG:${32600 + zone}`, label: `UTM Zone ${zone}N (WGS84)` };
  }),
];

type Position = number[];
type NestedPositions = Position | NestedPositions[];

function mapPositions(positions: NestedPositions, fn: (coord: Position) => Position): NestedPositions {
  if (typeof positions[0] === 'number') {
    return fn(positions as Position);
  }
  return (positions as NestedPositions[]).map((part) => mapPositions(part, fn));
}

function firstPosition(geometry: GeoJSON.Geometry | null | undefined): Position | null {
  if (!geometry) return null;
  const coords = geometry.coordinates as NestedPositions | undefined;
  if (!coords) return null;
  let current: NestedPositions = coords;
  while (Array.isArray(current[0])) {
    current = current[0] as NestedPositions;
  }
  return current as Position;
}

/** True when coordinates look like lon/lat degrees (not projected meters). */
export function looksLikeGeographic(collection: GeoJSON.FeatureCollection): boolean {
  for (const feature of collection.features) {
    const pos = firstPosition(feature.geometry);
    if (pos && pos.length >= 2 && Math.abs(pos[0]!) <= 180 && Math.abs(pos[1]!) <= 90) {
      return true;
    }
  }
  return false;
}

export function reprojectFeatureCollection(
  collection: GeoJSON.FeatureCollection,
  fromCrs: string,
  toCrs = 'EPSG:4326',
): GeoJSON.FeatureCollection {
  const convert = (coord: Position): Position => {
    const [x, y] = proj4(fromCrs, toCrs, [coord[0]!, coord[1]!]);
    return coord.length > 2 ? [x, y, coord[2]!] : [x, y];
  };

  return {
    type: 'FeatureCollection',
    features: collection.features.map((feature) => {
      if (!feature.geometry || !('coordinates' in feature.geometry)) return feature;
      return {
        ...feature,
        geometry: {
          ...feature.geometry,
          coordinates: mapPositions(feature.geometry.coordinates as NestedPositions, convert),
        },
      };
    }),
  };
}

/** Read legacy GeoJSON `"crs"` block (still common in older exports). */
export function detectGeoJsonCrs(geojson: GeoJSON.GeoJSON): string | undefined {
  if (!('crs' in geojson) || !geojson.crs || typeof geojson.crs !== 'object') return undefined;
  const crs = geojson.crs as { type?: string; properties?: { name?: string } };
  const name = crs.properties?.name?.trim();
  if (!name) return undefined;
  if (name.startsWith('EPSG:')) return name;
  const urn = name.match(/EPSG::(\d+)/i);
  return urn ? `EPSG:${urn[1]}` : name;
}
