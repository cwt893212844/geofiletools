import { convert, suggestedDownloadName, toGeoJSON } from './gdal-service';
import { repairDxfCp936Strings, warnIfDxfChineseLost } from './dxf-gbk-repair';
import type { ConvertOptions, GdalOperationOptions } from './types';

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
): Promise<{ blob: Blob; fileName: string; dxfFile: File }> {
  const dxfFile = await dwgToDxfFile(dwgFile, operationOptions);
  const blob = await convert([dxfFile], options, operationOptions);
  return {
    blob,
    fileName: suggestedDownloadName(dwgFile.name.replace(/\.dwg$/i, ''), options.outputFormat),
    dxfFile,
  };
}

export async function dwgToGeoJSON(dwgFile: File, targetCrs?: string): Promise<string> {
  const dxfFile = await dwgToDxfFile(dwgFile);
  return toGeoJSON([dxfFile], targetCrs);
}
