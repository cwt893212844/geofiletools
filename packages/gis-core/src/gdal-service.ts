import JSZip from 'jszip';
import type { ConvertOptions, GdalOperationOptions, GdalPaths, InspectResult, OutputFormat, ShapefileEncoding } from './types';
import { DEFAULT_GDAL_PATHS as defaultPaths } from './types';
import { prepareGdalInputFiles, SHAPEFILE_LAYER_PATH, type PreparedGdalInput } from './file-grouper';
import { assertDxfChineseReadable, DWG_CHINESE_LOST_ERROR, repairDxfCp936Strings, scanGeoJsonForReplacementChars } from './dxf-gbk-repair';
import { normalizeGeoJsonTextProperties, shapefileCpgForEncoding, transcodeDbfUtf8ToGbk } from './text-encoding';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GdalInstance = any;

interface OgrOutput {
  local?: string;
  real?: string;
  all?: Array<{ local: string; real: string }>;
}

let gdalInstance: GdalInstance | null = null;
let gdalLoadingPromise: Promise<GdalInstance> | null = null;

function resolveAssetUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  if (typeof window !== 'undefined') {
    return new URL(path, window.location.origin).toString();
  }
  return path;
}

function formatGdalErrorItem(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error) {
    const record = error as { message?: unknown; no?: unknown };
    const message = record.message != null ? String(record.message).trim() : '';
    if (message) return message;
    if (record.no != null) return `GDAL error ${record.no}`;
  }
  const text = String(error).trim();
  return text && text !== '[object Object]' ? text : 'Unknown GDAL error';
}

function formatGdalError(error: unknown): string {
  if (Array.isArray(error)) {
    const messages = error.map(formatGdalErrorItem).filter(Boolean);
    return messages.length ? messages.join('; ') : 'Unknown GDAL error';
  }
  return formatGdalErrorItem(error);
}

async function mountZipToMemfs(Gdal: GdalInstance, zipFile: File): Promise<void> {
  try {
    await Gdal.open(zipFile);
  } catch {
    // MEMFS mount completes before GDALOpenEx; zip container may not be a dataset.
  }
}

async function tryGdalOpen(
  Gdal: GdalInstance,
  target: string | File[],
  openOptions: string[],
  vfsHandlers: string[] = [],
): Promise<{ datasets?: unknown[]; errors?: unknown[] } | null> {
  try {
    const result = await Gdal.open(target, openOptions, vfsHandlers);
    return result?.datasets?.length ? result : null;
  } catch {
    return null;
  }
}

async function gdalOpen(
  Gdal: GdalInstance,
  prepared: PreparedGdalInput,
  openOptions: string[],
): Promise<{ datasets?: unknown[]; errors?: unknown[] }> {
  if (!prepared.shapefile) {
    const attempts = [
      openOptions,
      [...openOptions, 'ENCODING=GBK'],
      [...openOptions, 'ENCODING=UTF-8'],
      [],
    ];
    const seen = new Set<string>();

    for (const opts of attempts) {
      const key = opts.join('|');
      if (seen.has(key)) continue;
      seen.add(key);

      const opened = await tryGdalOpen(Gdal, prepared.files, opts);
      if (opened) return opened;
    }

    return Gdal.open(prepared.files, openOptions);
  }

  const { zipFile, components } = prepared.shapefile;
  await mountZipToMemfs(Gdal, zipFile);

  const encodingAttempts = [openOptions, [], ['ENCODING=GBK'], ['ENCODING=UTF-8']];
  const seen = new Set<string>();

  for (const opts of encodingAttempts) {
    const key = opts.join('|');
    if (seen.has(key)) continue;
    seen.add(key);

    const viaZip = await tryGdalOpen(Gdal, SHAPEFILE_LAYER_PATH, opts, ['vsizip']);
    if (viaZip) return viaZip;
  }

  for (const opts of encodingAttempts) {
    const key = `files:${opts.join('|')}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const viaFiles = await tryGdalOpen(Gdal, components, opts);
    if (viaFiles) return viaFiles;
  }

  return Gdal.open(SHAPEFILE_LAYER_PATH, openOptions, ['vsizip']);
}

function report(options: GdalOperationOptions | undefined, progress: number, message?: string) {
  options?.onProgress?.(progress, message);
}

export async function getGdal(
  paths: GdalPaths = defaultPaths,
  options?: GdalOperationOptions,
): Promise<GdalInstance> {
  if (gdalInstance) {
    report(options, 20, 'GIS engine ready');
    return gdalInstance;
  }
  if (gdalLoadingPromise) return gdalLoadingPromise;

  report(options, 5, 'Loading GIS engine…');

  gdalLoadingPromise = (async () => {
    try {
      let initFn: ((opts: Record<string, unknown>) => Promise<GdalInstance>) | null = null;

      try {
        const mod = await import('gdal3.js');
        if (typeof mod === 'function') {
          initFn = mod as typeof initFn;
        } else if (typeof mod.default === 'function') {
          initFn = mod.default as typeof initFn;
        } else if (typeof (mod as { initGdalJs?: typeof initFn }).initGdalJs === 'function') {
          initFn = (mod as { initGdalJs: typeof initFn }).initGdalJs;
        }
      } catch {
        // fallback to script tag
      }

      report(options, 10, 'Loading GIS engine…');

      if (!initFn) {
        await loadScript(resolveAssetUrl(paths.js));
        initFn = (window as { initGdalJs?: typeof initFn }).initGdalJs ?? null;
      }

      if (!initFn) {
        throw new Error('Failed to load gdal3.js initialization function.');
      }

      const basePath = resolveAssetUrl(paths.js).replace(/\/gdal3\.js$/, '');

      report(options, 15, 'Initializing WASM…');
      const initTimeoutMs = 300_000;
      gdalInstance = await Promise.race([
        initFn({
          path: basePath,
          useWorker: false,
        }),
        new Promise<never>((_, reject) => {
          setTimeout(
            () =>
              reject(
                new Error(
                  'GIS engine timed out loading. Try a hard refresh (Ctrl+F5) or check your network connection.',
                ),
              ),
            initTimeoutMs,
          );
        }),
      ]);

      report(options, 20, 'GIS engine ready');
      return gdalInstance;
    } catch (error) {
      gdalLoadingPromise = null;
      throw error;
    }
  })();

  return gdalLoadingPromise;
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as { initGdalJs?: unknown }).initGdalJs) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

async function openDataset(
  files: File[],
  options?: GdalOperationOptions,
): Promise<{ Gdal: GdalInstance; dataset: unknown; datasetFiles: File[] }> {
  const Gdal = await getGdal(options?.paths ?? defaultPaths, options);
  const prepared = await prepareGdalInputFiles(files);
  const datasetFiles = prepared.files;

  report(options, 30, 'Opening dataset…');

  const hasShp =
    prepared.shapefile != null ||
    datasetFiles.some((file) => file.name.toLowerCase().endsWith('.shp'));
  const openOptions = hasShp ? ['ENCODING=GBK'] : [];

  let result: { datasets?: unknown[]; errors?: unknown[] };
  try {
    result = await gdalOpen(Gdal, prepared, openOptions);
  } catch (error) {
    throw new Error(
      `GDAL could not open the input file(s): ${formatGdalError(error)}. Ensure .shp, .shx, and .dbf are included (or upload a .zip).`,
    );
  }

  if (!result?.datasets?.length) {
    const detail = result?.errors?.length
      ? formatGdalError(result.errors)
      : 'Unknown GDAL open error.';
    const shapefileHint = hasShp
      ? ' Ensure .shp, .shx, and .dbf are included (or upload a .zip).'
      : '';
    throw new Error(`GDAL could not open the input file(s): ${detail}${shapefileHint}`);
  }

  report(options, 40, 'Dataset opened');
  return { Gdal, dataset: result.datasets[0], datasetFiles };
}

function extractEpsgFromUnknown(value: unknown): string | undefined {
  if (value == null) return undefined;
  const text = JSON.stringify(value);
  if (!text) return undefined;
  const match = text.match(/"authority":"EPSG"[^}]*"code":(\d+)/) ?? text.match(/EPSG:(\d+)/);
  return match ? `EPSG:${match[1]}` : undefined;
}

export function parseOgrinfoResult(info: unknown): Pick<InspectResult, 'layers' | 'warnings'> & { driver?: string } {
  if (typeof info === 'object' && info && Array.isArray((info as { layers?: unknown }).layers)) {
    const json = info as {
      driverLongName?: string;
      layers?: Array<{
        name?: string;
        featureCount?: number;
        geometryFields?: Array<{ type?: string; coordinateSystem?: unknown }>;
        geometryType?: string | string[];
      }>;
      coordinateSystems?: unknown;
    };

    const layers = (json.layers ?? []).map((layer) => ({
      name: layer.name ?? 'unknown',
      geometryType:
        layer.geometryFields?.[0]?.type ??
        (Array.isArray(layer.geometryType) ? layer.geometryType[0] : layer.geometryType) ??
        'Unknown',
      featureCount: layer.featureCount ?? 0,
      crs:
        extractEpsgFromUnknown(layer.geometryFields?.[0]?.coordinateSystem) ??
        extractEpsgFromUnknown(json.coordinateSystems),
    }));

    return {
      driver: json.driverLongName,
      layers,
      warnings: layers.length
        ? []
        : ['No layers detected. The file may be empty or use an unsupported geometry type.'],
    };
  }

  const text = typeof info === 'string' ? info : JSON.stringify(info);
  const layers: InspectResult['layers'] = [];
  const layerBlocks = text.split(/Layer name:\s*/i).slice(1);

  for (const block of layerBlocks) {
    const name = block.split('\n')[0]?.trim() ?? 'unknown';
    const geomMatch = block.match(/Geometry:\s*(\w+)/i);
    const countMatch = block.match(/Feature Count:\s*(\d+)/i);
    layers.push({
      name,
      geometryType: geomMatch?.[1] ?? 'Unknown',
      featureCount: countMatch ? Number(countMatch[1]) : 0,
    });
  }

  const srsMatch = text.match(/EPSG:(\d+)/);
  if (srsMatch && layers[0]) {
    layers[0].crs = `EPSG:${srsMatch[1]}`;
  }

  return {
    layers,
    warnings: layers.length
      ? []
      : ['No layers detected. The file may be empty or use an unsupported geometry type.'],
  };
}

export function resolveShapefileEncoding(options: ConvertOptions): ShapefileEncoding {
  if (options.shapefileEncoding) return options.shapefileEncoding;
  return options.shapefileCompat ? 'CP936' : 'UTF-8';
}

export function buildOgr2OgrOptions(options: ConvertOptions): string[] {
  const opts = ['-f', options.outputFormat];

  if (options.sourceCrs) {
    opts.push('-s_srs', options.sourceCrs);
  }
  if (options.targetCrs) {
    opts.push('-t_srs', options.targetCrs);
  }
  if (options.layerName) {
    opts.push('-nln', options.layerName);
  }
  if (options.outputFormat === 'ESRI Shapefile') {
    // WASM reliably writes UTF-8; GBK output is applied when packaging the ZIP.
    opts.push('-lco', 'ENCODING=UTF-8');
    if (options.geometryType) {
      opts.push('-nlt', options.geometryType);
    }
  }
  if (options.outputFormat === 'GPKG') {
    opts.push('-lco', 'RASTER_TABLE=NO');
  }

  return opts;
}

export async function inspect(files: File[], options?: GdalOperationOptions): Promise<InspectResult> {
  const { Gdal, dataset } = await openDataset(files, options);

  try {
    report(options, 50, 'Reading layer metadata…');
    const info = await Gdal.ogrinfo(dataset, ['-so']);
    const parsed = parseOgrinfoResult(info);

    report(options, 55, 'Metadata ready');
    return {
      driver: parsed.driver,
      layers: parsed.layers,
      warnings: parsed.warnings,
    };
  } finally {
    Gdal.close(dataset);
  }
}

export async function convert(
  files: File[],
  convertOptions: ConvertOptions,
  operationOptions?: GdalOperationOptions,
): Promise<Blob> {
  if (convertOptions.outputFormat === 'ESRI Shapefile' && convertOptions.shapefileCompat) {
    return convertCadToShapefileZip(files, convertOptions, operationOptions);
  }

  const { Gdal, dataset } = await openDataset(files, operationOptions);

  try {
    report(operationOptions, 65, 'Converting…');
    let output: OgrOutput;
    try {
      output = await Gdal.ogr2ogr(
        dataset,
        buildOgr2OgrOptions(convertOptions),
        'converted',
      );
    } catch (error) {
      throw new Error(`Conversion failed: ${formatGdalError(error)}`);
    }

    if (convertOptions.outputFormat === 'ESRI Shapefile') {
      report(operationOptions, 80, 'Packaging shapefile…');
      return zipShapefileOutput(
        Gdal,
        output,
        operationOptions,
        undefined,
        resolveShapefileEncoding(convertOptions),
      );
    }

    report(operationOptions, 85, 'Preparing download…');
    const outputPath = output.local ?? output;
    const bytes: Uint8Array = await Gdal.getFileBytes(outputPath);
    if (!bytes?.length) {
      throw new Error(
        'Conversion produced an empty output file. Ensure the shapefile includes .shp, .shx, and .dbf with valid features.',
      );
    }
    const mime =
      convertOptions.outputFormat === 'GeoJSON'
        ? 'application/geo+json'
        : convertOptions.outputFormat === 'KML'
          ? 'application/vnd.google-earth.kml+xml'
          : convertOptions.outputFormat === 'GPKG'
            ? 'application/geopackage+sqlite3'
            : 'application/octet-stream';

    report(operationOptions, 95, 'Done');
    return new Blob([bytes], { type: mime });
  } finally {
    Gdal.close(dataset);
  }
}

async function zipShapefileOutput(
  Gdal: GdalInstance,
  output: OgrOutput,
  operationOptions?: GdalOperationOptions,
  namePrefix?: string,
  shapefileEncoding: ShapefileEncoding = 'UTF-8',
): Promise<Blob> {
  const zip = new JSZip();
  const files = output.all?.length
    ? output.all
    : output.local
      ? [{ local: output.local, real: output.real ?? output.local }]
      : [];

  if (!files.length) {
    throw new Error('Shapefile conversion produced no output files.');
  }

  let wroteCpg = false;

  for (const file of files) {
    const bytes: Uint8Array = await Gdal.getFileBytes(file.local);
    const rawName = file.local.split('/').pop() ?? file.local;
    const name = namePrefix
      ? rawName.replace(/^(converted|dataset)/, namePrefix)
      : rawName;
    if (name.toLowerCase().endsWith('.cpg')) wroteCpg = true;
    const payload =
      shapefileEncoding === 'CP936' && name.toLowerCase().endsWith('.dbf')
        ? transcodeDbfUtf8ToGbk(bytes)
        : bytes;
    zip.file(name, payload);
  }

  if (!wroteCpg || shapefileEncoding === 'CP936') {
    const shpName =
      files
        .map((file) => file.local.split('/').pop() ?? file.local)
        .find((name) => name.toLowerCase().endsWith('.shp'))
        ?.replace(/\.shp$/i, '') ?? namePrefix ?? 'converted';
    zip.file(`${shpName}.cpg`, shapefileCpgForEncoding(shapefileEncoding));
  }

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }, (metadata) => {
    report(operationOptions, 80 + (metadata.percent / 100) * 18, 'Packaging shapefile…');
  });
}

type GeometryBucket = 'points' | 'lines' | 'polygons';

function bucketGeometryType(type: string): GeometryBucket | null {
  if (type === 'Point' || type === 'MultiPoint') return 'points';
  if (type === 'LineString' || type === 'MultiLineString') return 'lines';
  if (type === 'Polygon' || type === 'MultiPolygon') return 'polygons';
  return null;
}

function splitFeaturesByGeometryType(features: GeoJSON.Feature[]): Record<GeometryBucket, GeoJSON.Feature[]> {
  const buckets: Record<GeometryBucket, GeoJSON.Feature[]> = {
    points: [],
    lines: [],
    polygons: [],
  };

  for (const feature of features) {
    if (!feature.geometry) continue;
    const bucket = bucketGeometryType(feature.geometry.type);
    if (bucket) buckets[bucket].push(feature);
  }

  return buckets;
}

const CAD_SHAPEFILE_LAYERS: Array<{ bucket: GeometryBucket; nlt: string; label: string }> = [
  { bucket: 'points', nlt: 'MULTIPOINT', label: 'points' },
  { bucket: 'lines', nlt: 'MULTILINESTRING', label: 'lines' },
  { bucket: 'polygons', nlt: 'MULTIPOLYGON', label: 'polygons' },
];

async function convertCadToShapefileZip(
  files: File[],
  convertOptions: ConvertOptions,
  operationOptions?: GdalOperationOptions,
): Promise<Blob> {
  report(operationOptions, 60, 'Reading CAD geometry…');
  const geojsonBlob = await convert(
    files,
    {
      outputFormat: 'GeoJSON',
      sourceCrs: convertOptions.sourceCrs,
      targetCrs: convertOptions.targetCrs,
    },
    operationOptions,
  );

  const collection = normalizeGeoJsonTextProperties(
    JSON.parse(await geojsonBlob.text()) as GeoJSON.FeatureCollection,
  );
  const replacementHits = scanGeoJsonForReplacementChars(collection);
  if (replacementHits > 0) {
    throw new Error(DWG_CHINESE_LOST_ERROR);
  }
  const buckets = splitFeaturesByGeometryType(collection.features ?? []);
  const layersToWrite = CAD_SHAPEFILE_LAYERS.filter((layer) => buckets[layer.bucket].length > 0);

  if (!layersToWrite.length) {
    throw new Error('No supported vector features found in CAD drawing.');
  }

  const zip = new JSZip();

  for (const [index, layer] of layersToWrite.entries()) {
    const progress = 68 + Math.round((index / layersToWrite.length) * 20);
    report(operationOptions, progress, `Writing ${layer.label}…`);

    const layerFile = new File(
      [JSON.stringify({ type: 'FeatureCollection', features: buckets[layer.bucket] })],
      `${layer.label}.geojson`,
      { type: 'application/geo+json' },
    );

    const layerZip = await convert([layerFile], {
      outputFormat: 'ESRI Shapefile',
      geometryType: layer.nlt,
      shapefileEncoding: 'CP936',
    }, operationOptions);

    const inner = await JSZip.loadAsync(await layerZip.arrayBuffer());
    for (const [path, entry] of Object.entries(inner.files)) {
      if (entry.dir) continue;
      const baseName = path.split('/').pop() ?? path;
      const renamed = baseName.replace(/^(converted|dataset)/, layer.label);
      let bytes = await entry.async('uint8array');
      if (renamed.toLowerCase().endsWith('.dbf')) {
        bytes = transcodeDbfUtf8ToGbk(bytes);
      }
      zip.file(renamed, bytes);
      if (renamed.toLowerCase().endsWith('.shp')) {
        zip.file(renamed.replace(/\.shp$/i, '.cpg'), shapefileCpgForEncoding('CP936'));
      }
    }
  }

  report(operationOptions, 92, 'Packaging shapefile…');
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }, (metadata) => {
    report(operationOptions, 92 + (metadata.percent / 100) * 7, 'Packaging shapefile…');
  });
}

export async function toGeoJSON(
  files: File[],
  targetCrs?: string,
  operationOptions?: GdalOperationOptions,
): Promise<string> {
  const convertOptions: ConvertOptions = { outputFormat: 'GeoJSON' };
  if (targetCrs) convertOptions.targetCrs = targetCrs;
  const blob = await convert(files, convertOptions, operationOptions);
  return blob.text();
}

export function isGdalReady(): boolean {
  return gdalInstance !== null;
}

export function outputExtension(format: OutputFormat): string {
  switch (format) {
    case 'ESRI Shapefile':
      return 'zip';
    case 'GeoJSON':
      return 'geojson';
    case 'KML':
      return 'kml';
    case 'GPX':
      return 'gpx';
    case 'GPKG':
      return 'gpkg';
    default:
      return 'bin';
  }
}

export function suggestedDownloadName(inputName: string, format: OutputFormat): string {
  const base = inputName.replace(/\.[^.]+$/, '') || 'converted';
  return `${base}.${outputExtension(format)}`;
}
