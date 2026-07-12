import { convert, getGdal, inspect, suggestedDownloadName, toGeoJSON } from './gdal-service';
import { prepareGdalInputFiles } from './file-grouper';
import { repairDxfCp936Strings, warnIfDxfChineseLost } from './dxf-gbk-repair';
import type { ConvertOptions, GdalOperationOptions } from './types';
import { DEFAULT_GDAL_PATHS } from './types';

/**
 * Read the $INSUNITS header variable from DXF bytes to determine the drawing unit.
 * Returns the numeric value or undefined if not found.
 */
function readDxfInsunits(dxf: Uint8Array): number | undefined {
  const text = new TextDecoder('ascii', { fatal: false }).decode(dxf);
  const headerIdx = text.indexOf('HEADER');
  if (headerIdx < 0) return undefined;
  const headerSection = text.slice(headerIdx);
  const insunitsMatch = headerSection.match(/\$INSUNITS\r?\n\s*7\r?\n\s*(\d+)/);
  if (!insunitsMatch) return undefined;
  return Number.parseInt(insunitsMatch[1], 10);
}

/**
 * CGCS2000 3-degree Gauss-Kruger zone → EPSG (CM-only, false easting 500k).
 * zone 24 → EPSG:4546 … zone 38 → EPSG:4560
 */
function cgcs2000ZoneToEpsg(zone: number): string {
  return `EPSG:${4546 + (zone - 24)}`;
}

/**
 * Detect the likely CRS for a DXF/DWG file based on GDAL inspect results and
 * coordinate analysis. Returns an EPSG string (e.g. "EPSG:4549") or undefined.
 */
export async function detectCadCrs(
  dxfFile: File,
  operationOptions?: GdalOperationOptions,
): Promise<string | undefined> {
  try {
    const info = await inspect([dxfFile], operationOptions);
    const existingCrs = info.layers.find((l) => l.crs)?.crs;
    if (existingCrs) return existingCrs;

    const bytes = new Uint8Array(await dxfFile.arrayBuffer());
    const insunits = readDxfInsunits(bytes);
    const scaleFactor = insunits === 4 ? 1000 : 1;

    const Gdal = await getGdal(DEFAULT_GDAL_PATHS, operationOptions);
    const prepared = await prepareGdalInputFiles([dxfFile]);
    const datasetResult = await Gdal.open(prepared.files, []);
    const dataset = datasetResult?.datasets?.[0];
    if (!dataset) return undefined;

    try {
      const infoDetail = await Gdal.ogrinfo(dataset, ['-al', '-so']);
      const text = typeof infoDetail === 'string' ? infoDetail : JSON.stringify(infoDetail);

      let x1: number | undefined;
      let y1: number | undefined;
      let x2: number | undefined;
      let y2: number | undefined;

      const extentMatch = text.match(
        /Extent:\s*\(([-\d.]+),\s*([-\d.]+)\)\s*-\s*\(([-\d.]+),\s*([-\d.]+)\)/,
      );
      if (extentMatch) {
        x1 = Number.parseFloat(extentMatch[1]);
        y1 = Number.parseFloat(extentMatch[2]);
        x2 = Number.parseFloat(extentMatch[3]);
        y2 = Number.parseFloat(extentMatch[4]);
      } else {
        try {
          const parsed = typeof infoDetail === 'object' ? infoDetail : JSON.parse(text);
          for (const layer of parsed?.layers ?? []) {
            const ext = layer.extent ?? layer.geometryFields?.[0]?.extent;
            if (Array.isArray(ext) && ext.length >= 4) {
              x1 = Number(ext[0]);
              y1 = Number(ext[1]);
              x2 = Number(ext[2]);
              y2 = Number(ext[3]);
              break;
            }
          }
        } catch {
          /* not JSON */
        }
      }

      if (
        x1 === undefined ||
        y1 === undefined ||
        x2 === undefined ||
        y2 === undefined ||
        [x1, y1, x2, y2].some((n) => Number.isNaN(n))
      ) {
        return undefined;
      }

      const xMin = Math.min(x1, x2) / scaleFactor;
      const xMax = Math.max(x1, x2) / scaleFactor;
      const yMin = Math.min(y1, y2) / scaleFactor;
      const yMax = Math.max(y1, y2) / scaleFactor;

      if (xMax <= 180 && xMin >= -180 && yMax <= 90 && yMin >= -90) {
        return 'EPSG:4326';
      }

      // Zone-prefixed CGCS2000 (e.g. 38xxxxxx easting → zone 38)
      const avgX = (xMin + xMax) / 2;
      if (avgX > 10_000_000 && avgX < 50_000_000 && yMin > 1_800_000 && yMax < 6_000_000) {
        const zone = Math.floor(avgX / 1_000_000);
        if (zone >= 24 && zone <= 45) return cgcs2000ZoneToEpsg(zone);
      }

      // CM-only false easting ≈500k — cannot recover zone; assign a common default
      if (xMin > 10_000 && xMax < 1_200_000 && yMin > 1_800_000 && yMax < 6_000_000) {
        return 'EPSG:4549';
      }

      if (
        Math.abs(xMin) > 1000 &&
        Math.abs(xMax) > 1000 &&
        yMin > 1_000_000 &&
        yMax < 6_000_000
      ) {
        return 'EPSG:4549';
      }

      return undefined;
    } finally {
      Gdal.close(dataset);
    }
  } catch {
    return undefined;
  }
}

function libredwgWasmBase(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return new URL('/libredwg', window.location.origin).pathname;
}

function formatDwgError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

/**
 * Return true when the DXF text contains at least one geometry entity in
 * the ENTITIES (model-space) section.  cadview sometimes returns a header-only
 * DXF with an empty ENTITIES section for DWG files it can't fully parse —
 * this check lets us fall back to LibreDWG in that case.
 */
function dxfHasModelSpaceEntities(dxfText: string): boolean {
  const ENTITY_RE = /\r?\n(LINE|LWPOLYLINE|POLYLINE|INSERT|TEXT|MTEXT|CIRCLE|ARC|POINT|SPLINE|3DFACE|SOLID)\r?\n/;
  // Try to start search from the ENTITIES section if it exists
  const entIdx = dxfText.search(/\r?\nENTITIES\r?\n/);
  if (entIdx >= 0) {
    return ENTITY_RE.test(dxfText.slice(entIdx));
  }
  // No ENTITIES section header found — check anywhere (handles unusual DXF structures)
  return ENTITY_RE.test(dxfText);
}

async function convertWithLibreDwg(buffer: ArrayBuffer): Promise<Uint8Array> {
  const { LibreDwg } = await import('@mlightcad/libredwg-web');
  const libredwg = await LibreDwg.create(libredwgWasmBase());
  const dxfBytes = libredwg.dwg_write_dxf(new Uint8Array(buffer));
  if (!dxfBytes) {
    throw new Error('LibreDWG could not convert this DWG. Try re-saving from AutoCAD or BricsCAD.');
  }
  return dxfBytes;
}

export async function dwgToDxfBytes(dwgFile: File): Promise<Uint8Array> {
  const buffer = await dwgFile.arrayBuffer();
  let primaryError: unknown;

  try {
    const { convertDwgToDxf } = await import('@cadview/dwg');
    const dxfString = await convertDwgToDxf(buffer, { timeout: 120_000 });
    // cadview can succeed but return a header-only DXF with no model-space
    // entities (e.g. files with mostly block-based geometry). Detect this
    // and fall through to LibreDWG so we get a complete conversion.
    if (dxfHasModelSpaceEntities(dxfString)) {
      return new TextEncoder().encode(dxfString);
    }
    primaryError = new Error(
      'cadview produced a DXF with no recognisable geometry — trying LibreDWG',
    );
  } catch (error) {
    primaryError = error;
  }

  try {
    return await convertWithLibreDwg(buffer);
  } catch (fallbackError) {
    const primary = formatDwgError(primaryError);
    const fallback = formatDwgError(fallbackError);
    throw new Error(
      `Failed to read DWG file. ${primary}${fallback !== primary ? ` LibreDWG fallback: ${fallback}` : ''}`,
    );
  }
}

export async function dwgToDxfFile(
  dwgFile: File,
  operationOptions?: GdalOperationOptions,
): Promise<File> {
  const bytes = await dwgToDxfBytes(dwgFile);
  const repaired = repairDxfCp936Strings(bytes);
  warnIfDxfChineseLost(repaired, operationOptions);
  const baseName = dwgFile.name.replace(/\.dwg$/i, '') || 'converted';
  return new File([repaired], `${baseName}.dxf`, { type: 'application/dxf' });
}

export async function convertDwg(
  dwgFile: File,
  options: ConvertOptions,
  operationOptions?: GdalOperationOptions,
): Promise<{ blob: Blob; fileName: string; dxfFile: File; detectedCrs?: string }> {
  const dxfFile = await dwgToDxfFile(dwgFile, operationOptions);

  // Detect CRS from the DXF before conversion so we can include .prj in the SHP output.
  const detectedCrs = await detectCadCrs(dxfFile, operationOptions);

  const convertedOptions: ConvertOptions = { ...options };
  if (detectedCrs && !convertedOptions.sourceCrs && !convertedOptions.targetCrs) {
    // Assign CRS to output without transforming coordinates.
    // This ensures the .prj file is included in the SHP ZIP.
    convertedOptions.assignCrs = detectedCrs;
  }

  const blob = await convert([dxfFile], convertedOptions, operationOptions);
  return {
    blob,
    fileName: suggestedDownloadName(dwgFile.name.replace(/\.dwg$/i, ''), options.outputFormat),
    dxfFile,
    detectedCrs,
  };
}

export async function dwgToGeoJSON(dwgFile: File, targetCrs?: string): Promise<string> {
  const dxfFile = await dwgToDxfFile(dwgFile);
  return toGeoJSON([dxfFile], targetCrs);
}
