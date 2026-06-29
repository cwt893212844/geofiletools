import { combine, parseDbf, parseShp } from 'shpjs';
import { looksLikeGeographic, reprojectFeatureCollection } from './coordinate';
import type { GdalOperationOptions, InspectResult } from './types';
import { getExtension, normalizeInputFiles } from './file-grouper';

interface ShapefileBuffers {
  shp: ArrayBuffer;
  dbf?: ArrayBuffer;
  prj?: ArrayBuffer;
  cpg?: ArrayBuffer;
}

interface FileEntry {
  name: string;
  ext: string;
  data: ArrayBuffer;
}

const SHAPEFILE_MAGIC = 0x0000270a;
const KNOWN_SHP_TYPES = new Set([0, 1, 3, 5, 8, 11, 13, 15, 18, 21, 23, 25, 28, 31]);

function cloneBuffer(buf: ArrayBuffer): ArrayBuffer {
  return buf.slice(0);
}

export function hasShapefileMagic(data: ArrayBuffer): boolean {
  const view = new DataView(data);
  return view.byteLength >= 4 && view.getUint32(0, false) === SHAPEFILE_MAGIC;
}

export function hasDbfMagic(data: ArrayBuffer): boolean {
  const view = new DataView(data);
  return view.byteLength >= 1 && view.getUint8(0) === 0x03;
}

export function readShapeTypeCode(data: ArrayBuffer): number | null {
  const view = new DataView(data);
  if (view.byteLength < 36) return null;
  return view.getInt32(32, true);
}

export function isValidShapeType(code: number): boolean {
  const normalized = code > 20 ? code - 20 : code;
  return KNOWN_SHP_TYPES.has(code) || KNOWN_SHP_TYPES.has(normalized);
}

function isPrjText(data: ArrayBuffer): boolean {
  const head = new TextDecoder('ascii').decode(data.slice(0, Math.min(256, data.byteLength)));
  return /^(GEOGCS|PROJCS|COMPD_CS|GEOCCS)/.test(head.trim());
}

function isCpgText(data: ArrayBuffer): boolean {
  const text = new TextDecoder('ascii').decode(data.slice(0, Math.min(32, data.byteLength))).trim();
  return /^(UTF-8|UTF8|CP936|GBK|GB2312|windows-1252|ISO-8859|OEM)/i.test(text);
}

/** Pick the main geometry (.shp) buffer — by content, not filename alone. */
export function pickShapeGeometryBuffer(entries: FileEntry[]): ArrayBuffer | null {
  const shapeLike = entries.filter((entry) => {
    if (!hasShapefileMagic(entry.data)) return false;
    const type = readShapeTypeCode(entry.data);
    return type != null && isValidShapeType(type);
  });

  if (!shapeLike.length) return null;

  shapeLike.sort((a, b) => {
    if (a.ext === 'shp' && b.ext !== 'shp') return -1;
    if (b.ext === 'shp' && a.ext !== 'shp') return 1;
    return b.data.byteLength - a.data.byteLength;
  });

  return shapeLike[0]!.data;
}

function pickDbfBuffer(entries: FileEntry[]): ArrayBuffer | undefined {
  const byExt = entries.find((entry) => entry.ext === 'dbf');
  if (byExt) return byExt.data;

  const byMagic = entries.find((entry) => hasDbfMagic(entry.data));
  return byMagic?.data;
}

function pickPrjBuffer(entries: FileEntry[]): ArrayBuffer | undefined {
  const byExt = entries.find((entry) => entry.ext === 'prj');
  if (byExt) return byExt.data;

  const byText = entries.find((entry) => isPrjText(entry.data));
  return byText?.data;
}

function pickCpgBuffer(entries: FileEntry[]): ArrayBuffer | undefined {
  const byExt = entries.find((entry) => entry.ext === 'cpg');
  if (byExt) return byExt.data;

  const byText = entries.find((entry) => isCpgText(entry.data));
  return byText?.data;
}

async function readShapefileBuffers(files: File[]): Promise<ShapefileBuffers> {
  const entries: FileEntry[] = await Promise.all(
    files.map(async (file) => ({
      name: file.name,
      ext: getExtension(file.name),
      data: await file.arrayBuffer(),
    })),
  );

  const shp = pickShapeGeometryBuffer(entries);
  if (!shp) {
    const misnamedShp = entries.find((entry) => entry.ext === 'shp');
    if (misnamedShp) {
      if (hasDbfMagic(misnamedShp.data)) {
        throw new Error(
          'The file named .shp contains DBF attribute data, not geometry. Re-export the shapefile or upload a .zip bundle.',
        );
      }
      if (!hasShapefileMagic(misnamedShp.data)) {
        throw new Error(
          'The file named .shp is not a valid ESRI shapefile (missing file signature).',
        );
      }
      const type = readShapeTypeCode(misnamedShp.data);
      throw new Error(
        `Invalid shapefile geometry type (${type ?? 'unknown'}). The .shp file may be corrupt or incomplete.`,
      );
    }
    throw new Error('Shapefile is missing a valid .shp geometry file.');
  }

  const dbf = pickDbfBuffer(entries);
  if (!dbf?.byteLength) {
    throw new Error('Shapefile is missing a valid .dbf file.');
  }

  return {
    shp,
    dbf,
    prj: pickPrjBuffer(entries),
    cpg: pickCpgBuffer(entries),
  };
}

function normalizeShpjsResult(
  result: GeoJSON.FeatureCollection | GeoJSON.FeatureCollection[],
): GeoJSON.FeatureCollection {
  if (Array.isArray(result)) {
    return {
      type: 'FeatureCollection',
      features: result.flatMap((collection) => collection.features ?? []),
    };
  }
  return result;
}

async function parseWithShpjs(buffers: ShapefileBuffers): Promise<GeoJSON.FeatureCollection> {
  const shpBuf = cloneBuffer(buffers.shp);
  const prjText = buffers.prj ? new TextDecoder().decode(buffers.prj) : undefined;

  const cpgVariants: Array<string | undefined> = buffers.cpg
    ? [new TextDecoder().decode(buffers.cpg)]
    : [undefined, 'CP936', 'GBK'];

  await new Promise<void>((resolve) => setTimeout(resolve, 0));

  let lastError: unknown;

  for (const cpg of cpgVariants) {
    try {
      const geometries = parseShp(shpBuf, prjText);
      const properties = parseDbf(cloneBuffer(buffers.dbf!), cpg);
      return normalizeShpjsResult(combine([geometries, properties]));
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Failed to parse shapefile.');
}

function ensureWgs84ForMap(
  collection: GeoJSON.FeatureCollection,
  prjText?: string,
): { collection: GeoJSON.FeatureCollection; warnings: string[] } {
  const warnings: string[] = [];

  if (looksLikeGeographic(collection)) {
    return { collection, warnings };
  }

  if (!prjText) {
    warnings.push('No .prj file — map preview assumes WGS84; coordinates may appear in the wrong place.');
    return { collection, warnings };
  }

  try {
    return {
      collection: reprojectFeatureCollection(collection, prjText),
      warnings,
    };
  } catch {
    warnings.push('Could not reproject to WGS84 for map display. Check that the .prj file is valid.');
    return { collection, warnings };
  }
}

function buildInspectResult(
  collection: GeoJSON.FeatureCollection,
  warnings: string[] = [],
  crs = 'EPSG:4326',
): InspectResult {
  const geometryTypes = new Set(
    collection.features.map((feature) => feature.geometry?.type).filter(Boolean) as string[],
  );

  return {
    layers: [
      {
        name: 'features',
        geometryType: geometryTypes.size === 1 ? [...geometryTypes][0]! : 'Mixed',
        featureCount: collection.features.length,
        crs,
      },
    ],
    warnings,
  };
}

export async function convertShapefileToGeoJSON(
  files: File[],
  options?: GdalOperationOptions,
): Promise<{ blob: Blob; inspect: InspectResult }> {
  const report = (progress: number, message?: string) => options?.onProgress?.(progress, message);

  report(15, 'Reading shapefile…');
  const groups = await normalizeInputFiles(files);
  const group = groups[0] ?? files;
  const extraWarnings: string[] = [];

  if (groups.length > 1) {
    extraWarnings.push(
      `Multiple shapefiles detected (${groups.length}); only the first dataset was converted.`,
    );
  }

  if (!group.some((file) => getExtension(file.name) === 'shp')) {
    throw new Error('No .shp file found. Upload .shp + .shx + .dbf or a .zip shapefile.');
  }

  const buffers = await readShapefileBuffers(group);
  const prjText = buffers.prj ? new TextDecoder().decode(buffers.prj) : undefined;

  report(55, 'Converting to GeoJSON…');
  let collection = await parseWithShpjs(buffers);

  if (!collection.features?.length) {
    throw new Error('Shapefile contains no features.');
  }

  const { collection: wgs84Collection, warnings: crsWarnings } = ensureWgs84ForMap(collection, prjText);
  collection = wgs84Collection;

  report(90, 'Preparing download…');
  const blob = new Blob([JSON.stringify(collection)], { type: 'application/geo+json' });
  return {
    blob,
    inspect: buildInspectResult(collection, [...extraWarnings, ...crsWarnings], 'EPSG:4326'),
  };
}
