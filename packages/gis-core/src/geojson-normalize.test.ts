import { describe, expect, it } from 'vitest';
import { parseGeoJsonCollection, prepareGeoJsonForOgr, prepareGeoJsonInput } from './geojson-normalize';

describe('geojson-normalize', () => {
  it('parses FeatureCollection', () => {
    const fc = parseGeoJsonCollection('{"type":"FeatureCollection","features":[]}');
    expect(fc.type).toBe('FeatureCollection');
  });

  it('flattens nested properties for ogr', () => {
    const fc = prepareGeoJsonForOgr({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {
            name: '村级',
            meta: { code: 12, tags: ['a', 'b'] },
          },
          geometry: { type: 'Point', coordinates: [120, 30] },
        },
      ],
    });

    expect(fc.features[0]?.properties?.name).toBe('村级');
    expect(fc.features[0]?.properties?.meta).toBe('{"code":12,"tags":["a","b"]}');
  });

  it('reads ArcGIS-style attributes', () => {
    const fc = prepareGeoJsonForOgr({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          attributes: { FID: 1, 名称: '测试' },
          geometry: { type: 'Point', coordinates: [120, 30] },
        } as GeoJSON.Feature,
      ],
    });

    expect(fc.features[0]?.properties?.FID).toBe(1);
    expect(fc.features[0]?.properties?.名称).toBe('测试');
  });

  it('warns on CAD local coordinates without CRS metadata', () => {
    const prepared = prepareGeoJsonInput(
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: { type: 'Point', coordinates: [-100, 997000] },
          },
        ],
      }),
    );
    expect(prepared.sourceCrs).toBeUndefined();
    expect(prepared.warnings.some((w) => /local CAD/i.test(w))).toBe(true);
  });

  it('does not warn for WGS84 GeoJSON', () => {
    const prepared = prepareGeoJsonInput(
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: { type: 'Point', coordinates: [113.3, 22.1] },
          },
        ],
      }),
    );
    expect(prepared.warnings).toEqual([]);
  });
});
