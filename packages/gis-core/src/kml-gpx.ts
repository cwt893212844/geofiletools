import JSZip from 'jszip';
import { kml, gpx } from '@tmcw/togeojson';
import { convert } from './gdal-service';

function readFileAsText(file: File): Promise<string> {
  return file.text();
}

async function readKmz(file: File): Promise<string> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const kmlEntry =
    Object.values(zip.files).find((entry) => !entry.dir && entry.name.toLowerCase().endsWith('.kml')) ??
    Object.values(zip.files).find((entry) => !entry.dir);

  if (!kmlEntry) {
    throw new Error('KMZ archive does not contain a KML file.');
  }

  return kmlEntry.async('text');
}

export async function kmlOrKmzToGeoJSON(file: File): Promise<GeoJSON.FeatureCollection> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  const text = ext === 'kmz' ? await readKmz(file) : await readFileAsText(file);
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  return kml(doc);
}

export async function gpxToGeoJSON(file: File): Promise<GeoJSON.FeatureCollection> {
  const text = await readFileAsText(file);
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  return gpx(doc);
}

export async function geoJSONToKml(
  geojson: GeoJSON.FeatureCollection,
  sourceCrs?: string,
): Promise<Blob> {
  const file = new File([JSON.stringify(geojson)], 'input.geojson', {
    type: 'application/geo+json',
  });
  return convert([file], {
    outputFormat: 'KML',
    targetCrs: 'EPSG:4326',
    sourceCrs,
  });
}

export async function geoJSONToGpx(geojson: GeoJSON.FeatureCollection): Promise<Blob> {
  const file = new File([JSON.stringify(geojson)], 'input.geojson', {
    type: 'application/geo+json',
  });
  return convert([file], { outputFormat: 'GPX' });
}

export async function kmlOrGpxFileToGeoJSONBlob(file: File): Promise<Blob> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  const collection =
    ext === 'gpx' ? await gpxToGeoJSON(file) : await kmlOrKmzToGeoJSON(file);
  return new Blob([JSON.stringify(collection)], { type: 'application/geo+json' });
}
