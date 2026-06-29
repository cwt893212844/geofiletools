import { describe, expect, it } from 'vitest';
import {
  hasDbfMagic,
  hasShapefileMagic,
  isValidShapeType,
  pickShapeGeometryBuffer,
  readShapeTypeCode,
} from '../src/shapefile-to-geojson';

function makeShapefileHeader(shapeType = 5): ArrayBuffer {
  const buf = new ArrayBuffer(100);
  const view = new DataView(buf);
  view.setUint32(0, 0x0000270a, false);
  view.setInt32(32, shapeType, true);
  return buf;
}

function makeDbfHeader(): ArrayBuffer {
  const buf = new ArrayBuffer(100);
  new DataView(buf).setUint8(0, 0x03);
  return buf;
}

describe('shapefile-to-geojson helpers', () => {
  it('detects shapefile magic and geometry type', () => {
    const shp = makeShapefileHeader(5);
    expect(hasShapefileMagic(shp)).toBe(true);
    expect(readShapeTypeCode(shp)).toBe(5);
    expect(isValidShapeType(5)).toBe(true);
  });

  it('detects dbf magic', () => {
    expect(hasDbfMagic(makeDbfHeader())).toBe(true);
    expect(hasDbfMagic(makeShapefileHeader())).toBe(false);
  });

  it('picks geometry by content when .shp filename contains dbf bytes', () => {
    const shpBytes = makeShapefileHeader(5);
    const dbfBytes = makeDbfHeader();
    const picked = pickShapeGeometryBuffer([
      { name: '村级界线.shp', ext: 'shp', data: dbfBytes },
      { name: '村级界线.shx', ext: 'shx', data: shpBytes },
    ]);
    expect(picked).toBe(shpBytes);
  });

  it('prefers .shp extension when multiple shapefile-magic files exist', () => {
    const main = makeShapefileHeader(5);
    const index = makeShapefileHeader(5);
    const picked = pickShapeGeometryBuffer([
      { name: 'layer.shx', ext: 'shx', data: index },
      { name: 'layer.shp', ext: 'shp', data: main },
    ]);
    expect(picked).toBe(main);
  });
});
