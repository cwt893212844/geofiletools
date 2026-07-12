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

function sampleCoordinateExtents(collection: GeoJSON.FeatureCollection): {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
} | undefined {
  const positions: number[][] = [];
  for (const f of collection.features) {
    if (!f.geometry) continue;
    const pos = firstPosition(f.geometry);
    if (pos && pos.length >= 2) positions.push(pos);
    if (positions.length >= 10) break;
  }
  if (positions.length === 0) return undefined;

  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const [x, y] of positions) {
    if (x < xMin) xMin = x;
    if (x > xMax) xMax = x;
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  }
  return { xMin, xMax, yMin, yMax };
}

function isGeographicExtent(xMin: number, xMax: number, yMin: number, yMax: number): boolean {
  return xMax <= 180 && xMin >= -180 && yMax <= 90 && yMin >= -90;
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

function cgcs2000ZoneToEpsg(zone: number): string {
  return `EPSG:${4546 + (zone - 24)}`;
}

/** Infer CRS from coordinate values in a GeoJSON collection (heuristic). */
export function detectGeoJsonCrsFromCoords(collection: GeoJSON.FeatureCollection): string | undefined {
  const extents = sampleCoordinateExtents(collection);
  if (!extents) return undefined;
  const { xMin, xMax, yMin, yMax } = extents;

  // Geographic coordinates → WGS84
  if (isGeographicExtent(xMin, xMax, yMin, yMax)) {
    return undefined; // already geographic, no assignment needed
  }

  // Zone-prefixed CGCS2000 (e.g. 38xxxxxx easting → zone 38)
  const avgX = (xMin + xMax) / 2;
  if (avgX > 10_000_000 && avgX < 50_000_000 && yMin > 1_800_000 && yMax < 6_000_000) {
    const zone = Math.floor(avgX / 1_000_000);
    if (zone >= 24 && zone <= 45) return cgcs2000ZoneToEpsg(zone);
  }

  // Chinese 3-degree projected CRS (CM-only, false easting ≈500k)
  if (xMin > 10_000 && xMax < 1_200_000 && yMin > 1_800_000 && yMax < 6_000_000) {
    return 'EPSG:4549';
  }

  // Fallback: large coords that are clearly projected
  if (
    Math.abs(xMin) > 1000 &&
    Math.abs(xMax) > 1000 &&
    yMin > 1_000_000 &&
    yMax < 6_000_000
  ) {
    return 'EPSG:4549';
  }

  return undefined;
}

/**
 * Warn when coordinates are neither WGS84 nor a recognizable projected CRS.
 * Typical case: CAD local/engineering coords written into GeoJSON (e.g. X≈±100, Y≈1e6).
 */
export function detectSuspiciousGeoJsonCoords(
  collection: GeoJSON.FeatureCollection,
): string | undefined {
  const extents = sampleCoordinateExtents(collection);
  if (!extents) return undefined;
  const { xMin, xMax, yMin, yMax } = extents;

  if (isGeographicExtent(xMin, xMax, yMin, yMax)) return undefined;
  if (detectGeoJsonCrsFromCoords(collection)) return undefined;

  return (
    'Coordinates do not look like WGS84 lon/lat or a known projected CRS (CGCS2000/UTM). ' +
    'They may be a local CAD/engineering system. Output keeps these values as-is — ' +
    'assign the correct CRS in QGIS, or re-export from CAD/GIS with CRS metadata.'
  );
}
