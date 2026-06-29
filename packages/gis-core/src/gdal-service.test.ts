import { describe, expect, it } from 'vitest';
import { parseOgrinfoResult } from './gdal-service';

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
