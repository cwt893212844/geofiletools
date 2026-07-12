import { describe, expect, it } from 'vitest';
import {
  detectGeoJsonCrsFromCoords,
  detectSuspiciousGeoJsonCoords,
} from './coordinate';

function pointCollection(coords: number[][]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: coords.map((coordinates, i) => ({
      type: 'Feature',
      properties: { id: i },
      geometry: { type: 'Point', coordinates },
    })),
  };
}

describe('detectGeoJsonCrsFromCoords', () => {
  it('returns undefined for WGS84 lon/lat', () => {
    expect(
      detectGeoJsonCrsFromCoords(pointCollection([[113.3, 22.1], [113.4, 22.2]])),
    ).toBeUndefined();
  });

  it('detects zone-prefixed CGCS2000 easting', () => {
    expect(
      detectGeoJsonCrsFromCoords(pointCollection([[38450000, 2400000], [38460000, 2410000]])),
    ).toBe('EPSG:4560');
  });

  it('assigns default for CM-only projected range', () => {
    expect(
      detectGeoJsonCrsFromCoords(pointCollection([[500000, 2400000], [510000, 2410000]])),
    ).toBe('EPSG:4549');
  });
});

describe('detectSuspiciousGeoJsonCoords', () => {
  it('does not warn for WGS84', () => {
    expect(
      detectSuspiciousGeoJsonCoords(pointCollection([[113.3, 22.1], [113.4, 22.2]])),
    ).toBeUndefined();
  });

  it('does not warn when a projected CRS can be inferred', () => {
    expect(
      detectSuspiciousGeoJsonCoords(pointCollection([[500000, 2400000], [510000, 2410000]])),
    ).toBeUndefined();
  });

  it('warns for CAD local engineering coords (small X, huge Y)', () => {
    const warning = detectSuspiciousGeoJsonCoords(
      pointCollection([
        [-165, 997000],
        [80, 997500],
      ]),
    );
    expect(warning).toMatch(/local CAD\/engineering/i);
  });
});
