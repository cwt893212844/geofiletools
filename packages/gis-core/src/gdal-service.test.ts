import { describe, expect, it } from 'vitest';
import { buildOgr2OgrOptions, parseOgrinfoResult, resolveShapefileEncoding } from './gdal-service';

describe('buildOgr2OgrOptions', () => {
  it('omits target CRS when not provided (CAD drawings without SRS)', () => {
    const opts = buildOgr2OgrOptions({ outputFormat: 'ESRI Shapefile' });
    expect(opts).not.toContain('-t_srs');
    expect(opts).not.toContain('EPSG:4326');
  });

  it('includes target CRS when provided', () => {
    const opts = buildOgr2OgrOptions({ outputFormat: 'GeoJSON', targetCrs: 'EPSG:4326' });
    expect(opts).toContain('-t_srs');
    expect(opts).toContain('EPSG:4326');
  });

  it('adds explicit geometry type for shapefile layers', () => {
    const opts = buildOgr2OgrOptions({
      outputFormat: 'ESRI Shapefile',
      geometryType: 'MULTIPOLYGON',
    });
    expect(opts).toContain('-nlt');
    expect(opts).toContain('MULTIPOLYGON');
  });

  it('uses CP936 when packaging CAD shapefiles', () => {
    expect(resolveShapefileEncoding({ outputFormat: 'ESRI Shapefile', shapefileCompat: true })).toBe(
      'CP936',
    );
    const opts = buildOgr2OgrOptions({
      outputFormat: 'ESRI Shapefile',
      shapefileCompat: true,
    });
    expect(opts).toContain('ENCODING=UTF-8');
  });

  it('keeps UTF-8 for non-CAD shapefile exports', () => {
    const opts = buildOgr2OgrOptions({ outputFormat: 'ESRI Shapefile' });
    expect(opts).toContain('ENCODING=UTF-8');
  });
});

describe('parseOgrinfoResult', () => {
  it('parses gdal3.js JSON ogrinfo output', () => {
    const parsed = parseOgrinfoResult({
      driverLongName: 'ESRI Shapefile',
      layers: [
        {
          name: 'dataset',
          featureCount: 42,
          geometryFields: [{ type: 'Polygon' }],
        },
      ],
    });

    expect(parsed.driver).toBe('ESRI Shapefile');
    expect(parsed.layers).toEqual([
      {
        name: 'dataset',
        geometryType: 'Polygon',
        featureCount: 42,
        crs: undefined,
      },
    ]);
    expect(parsed.warnings).toEqual([]);
  });

  it('falls back to legacy text output', () => {
    const parsed = parseOgrinfoResult(`Layer name: parcels
Geometry: Polygon
Feature Count: 3
`);

    expect(parsed.layers[0]).toMatchObject({
      name: 'parcels',
      geometryType: 'Polygon',
      featureCount: 3,
    });
  });
});
