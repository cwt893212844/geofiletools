import { convert, suggestedDownloadName, toGeoJSON } from './gdal-service';
import { assertDxfChineseReadable, repairDxfCp936Strings } from './dxf-gbk-repair';
import type { ConvertOptions, GdalOperationOptions } from './types';

function libredwgWasmBase(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return new URL('/libredwg', window.location.origin).pathname;
}

function formatDwgError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
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
    return new TextEncoder().encode(dxfString);
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

export async function dwgToDxfFile(dwgFile: File): Promise<File> {
  const bytes = await dwgToDxfBytes(dwgFile);
  const repaired = repairDxfCp936Strings(bytes);
  assertDxfChineseReadable(repaired, dwgFile.name);
  const baseName = dwgFile.name.replace(/\.dwg$/i, '') || 'converted';
  return new File([repaired], `${baseName}.dxf`, { type: 'application/dxf' });
}

export async function convertDwg(
  dwgFile: File,
  options: ConvertOptions,
  operationOptions?: GdalOperationOptions,
): Promise<{ blob: Blob; fileName: string; dxfFile: File }> {
  const dxfFile = await dwgToDxfFile(dwgFile);
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
