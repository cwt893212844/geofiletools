import { convert, suggestedDownloadName, toGeoJSON } from './gdal-service';
import type { ConvertOptions, GdalOperationOptions } from './types';

export async function dwgToDxfBytes(dwgFile: File): Promise<Uint8Array> {
  const buffer = await dwgFile.arrayBuffer();

  try {
    const { convertDwgToDxf } = await import('@cadview/dwg');
    const dxfString = await convertDwgToDxf(buffer, { timeout: 120_000 });
    return new TextEncoder().encode(dxfString);
  } catch {
    const { LibreDwg } = await import('@mlightcad/libredwg-web');
    const libredwg = await LibreDwg.create();
    const dxfBytes = libredwg.dwg_write_dxf(new Uint8Array(buffer));
    if (!dxfBytes) {
      throw new Error('Failed to read DWG file. Try saving as DXF from AutoCAD or BricsCAD.');
    }
    return dxfBytes;
  }
}

export async function dwgToDxfFile(dwgFile: File): Promise<File> {
  const bytes = await dwgToDxfBytes(dwgFile);
  const baseName = dwgFile.name.replace(/\.dwg$/i, '') || 'converted';
  return new File([bytes], `${baseName}.dxf`, { type: 'application/dxf' });
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

export async function dwgToGeoJSON(dwgFile: File, targetCrs = 'EPSG:4326'): Promise<string> {
  const dxfFile = await dwgToDxfFile(dwgFile);
  return toGeoJSON([dxfFile], targetCrs);
}
