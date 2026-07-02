import JSZip from 'jszip';
import { assertDxfChineseReadable, repairDxfCp936Strings } from './dxf-gbk-repair';

const VECTOR_EXTENSIONS = new Set([
  'gpkg',
  'shp',
  'geojson',
  'json',
  'gml',
  'kml',
  'kmz',
  'fgb',
  'tab',
  'mif',
  'gdb',
  'sqlite',
  'csv',
  'tsv',
  'gpx',
  'ods',
  'xlsx',
  'dxf',
  'dgn',
  'dwg',
  'zip',
]);

const SHAPEFILE_SIDECARS = new Set([
  'shx',
  'dbf',
  'prj',
  'cpg',
  'sbn',
  'sbx',
  'qix',
  'xml',
]);

export function getExtension(filename: string): string {
  const parts = filename.toLowerCase().split('.');
  return parts.length > 1 ? (parts.pop() ?? '') : '';
}

export function isSupportedVectorFile(filename: string): boolean {
  const ext = getExtension(filename);
  return VECTOR_EXTENSIONS.has(ext) || SHAPEFILE_SIDECARS.has(ext);
}

export function isShapefileUpload(files: File[]): boolean {
  return files.some((file) => {
    const ext = getExtension(file.name);
    return ext === 'shp' || ext === 'zip' || SHAPEFILE_SIDECARS.has(ext);
  });
}

export function groupFilesByDataset(files: File[]): File[][] {
  const byBaseName: Record<string, File[]> = {};

  for (const file of files) {
    const ext = getExtension(file.name);
    const base =
      ext && (ext === 'shp' || SHAPEFILE_SIDECARS.has(ext))
        ? file.name.replace(/\.[^.]+$/i, '').toLowerCase()
        : file.name.toLowerCase();

    if (!byBaseName[base]) {
      byBaseName[base] = [];
    }
    byBaseName[base].push(file);
  }

  const groups = Object.values(byBaseName);
  return groups.filter((group) => group.some((f) => getExtension(f.name) === 'shp') || group.length === 1);
}

export async function expandZipFiles(files: File[]): Promise<File[]> {
  const expanded: File[] = [];

  for (const file of files) {
    if (getExtension(file.name) !== 'zip') {
      expanded.push(file);
      continue;
    }

    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    for (const [path, entry] of Object.entries(zip.files)) {
      if (entry.dir) continue;
      const baseName = path.split('/').pop() ?? path;
      const data = await entry.async('uint8array');
      expanded.push(new File([data], baseName, { type: 'application/octet-stream' }));
    }
  }

  return expanded;
}

export async function normalizeInputFiles(files: File[]): Promise<File[][]> {
  const expanded = await expandZipFiles(files);
  return groupFilesByDataset(expanded);
}

const SHAPEFILE_ORDER = ['shp', 'shx', 'dbf', 'prj', 'cpg', 'sbn', 'sbx', 'qix'];

function sortShapefileGroup(files: File[]): File[] {
  return [...files].sort((a, b) => {
    const extA = getExtension(a.name);
    const extB = getExtension(b.name);
    return (SHAPEFILE_ORDER.indexOf(extA) ?? 99) - (SHAPEFILE_ORDER.indexOf(extB) ?? 99);
  });
}

export interface PreparedGdalInput {
  files: File[];
  shapefile?: {
    zipFile: File;
    components: File[];
  };
}

export const SHAPEFILE_ZIP_NAME = 'shapefile.zip';
export const SHAPEFILE_LAYER_PATH = `/input/${SHAPEFILE_ZIP_NAME}/dataset.shp`;

/** GDAL WASM MEMFS is unreliable with non-ASCII paths — rename before open. */
export async function sanitizeFilesForGdal(files: File[]): Promise<File[]> {
  const hasShp = files.some((file) => getExtension(file.name) === 'shp');
  const ordered = hasShp ? sortShapefileGroup(files) : files;
  const sanitized: File[] = [];

  for (const [index, file] of ordered.entries()) {
    const ext = getExtension(file.name) || 'bin';
    let bytes = await file.arrayBuffer();
    if (ext === 'dxf') {
      const repaired = repairDxfCp936Strings(new Uint8Array(bytes));
      assertDxfChineseReadable(repaired, file.name);
      bytes = repaired.buffer.slice(repaired.byteOffset, repaired.byteOffset + repaired.byteLength);
    }
    const name = hasShp ? `dataset.${ext}` : `dataset_${index}.${ext}`;
    sanitized.push(
      new File([bytes], name, {
        type: file.type || 'application/octet-stream',
        lastModified: file.lastModified,
      }),
    );
  }

  return sanitized;
}

async function shapefileComponentsToZip(files: File[]): Promise<File> {
  const zip = new JSZip();

  for (const file of files) {
    zip.file(file.name, await file.arrayBuffer());
  }

  const bytes = await zip.generateAsync({
    type: 'uint8array',
    compression: 'STORE',
  });

  return new File([bytes], SHAPEFILE_ZIP_NAME, { type: 'application/zip' });
}

function assertShapefileSidecars(files: File[]): void {
  const extensions = new Set(files.map((file) => getExtension(file.name)));
  const missing: string[] = [];
  if (!extensions.has('shp')) missing.push('.shp');
  if (!extensions.has('shx')) missing.push('.shx');
  if (!extensions.has('dbf')) missing.push('.dbf');
  if (missing.length) {
    throw new Error(`Shapefile is missing required files: ${missing.join(', ')}`);
  }
}

export async function prepareGdalInputFiles(files: File[]): Promise<PreparedGdalInput> {
  const groups = await normalizeInputFiles(files);
  const group = groups[0] ?? files;
  const sanitized = await sanitizeFilesForGdal(group);
  const hasShp = sanitized.some((file) => getExtension(file.name) === 'shp');

  if (hasShp) {
    assertShapefileSidecars(sanitized);
    const zipFile = await shapefileComponentsToZip(sanitized);
    return {
      files: [zipFile],
      shapefile: { zipFile, components: sanitized },
    };
  }

  return { files: sanitized };
}
