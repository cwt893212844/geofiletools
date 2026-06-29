import { describe, expect, it } from 'vitest';
import {
  getExtension,
  groupFilesByDataset,
  isSupportedVectorFile,
  prepareGdalInputFiles,
  sanitizeFilesForGdal,
} from '../src/file-grouper';

describe('file-grouper', () => {
  it('groups shapefile sidecars by basename', () => {
    const files = [
      new File([''], 'parcel.shp'),
      new File([''], 'parcel.dbf'),
      new File([''], 'parcel.shx'),
      new File([''], 'parcel.prj'),
    ];

    const groups = groupFilesByDataset(files);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(4);
  });

  it('detects supported vector extensions', () => {
    expect(isSupportedVectorFile('roads.dxf')).toBe(true);
    expect(isSupportedVectorFile('parcel.shp')).toBe(true);
    expect(isSupportedVectorFile('notes.txt')).toBe(false);
  });

  it('reads lowercase extensions', () => {
    expect(getExtension('Layer.DXF')).toBe('dxf');
  });

  it('renames non-ascii shapefile names for gdal wasm', async () => {
    const files = [
      new File(['dbf'], '村级界线.dbf'),
      new File(['shp'], '村级界线.shp'),
      new File(['shx'], '村级界线.shx'),
      new File(['prj'], '村级界线.prj'),
    ];

    const sanitized = await sanitizeFilesForGdal(files);
    expect(sanitized.map((file) => file.name)).toEqual([
      'dataset.shp',
      'dataset.shx',
      'dataset.dbf',
      'dataset.prj',
    ]);
    await expect(sanitized[0]?.arrayBuffer()).resolves.toHaveProperty('byteLength', 3);
  });

  it('prepares shapefile zip bundle with inner dataset.shp path', async () => {
    const files = [
      new File(['shp'], '村级界线.shp'),
      new File(['shx'], '村级界线.shx'),
      new File(['dbf'], '村级界线.dbf'),
    ];

    const prepared = await prepareGdalInputFiles(files);
    expect(prepared.shapefile).toBeDefined();
    expect(prepared.files).toHaveLength(1);
    expect(prepared.files[0]?.name).toBe('shapefile.zip');
    expect(prepared.shapefile?.components.map((file) => file.name)).toEqual([
      'dataset.shp',
      'dataset.shx',
      'dataset.dbf',
    ]);
  });
});
