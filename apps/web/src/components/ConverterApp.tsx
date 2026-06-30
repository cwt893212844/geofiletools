import { useMemo, useState } from 'react';
import {
  convert,
  convertDwg,
  convertShapefileToGeoJSON,
  dwgToDxfFile,
  geoJSONToKml,
  inspect,
  kmlOrGpxFileToGeoJSONBlob,
  prepareGeoJsonInput,
  suggestedDownloadName,
  toGeoJSON,
  type ConversionStage,
  type InspectResult,
  type OutputFormat,
} from '@gis-tools/core';
import { GDAL_PATHS } from '../lib/gdal-paths';
import { ConversionProgress } from './ConversionProgress';
import { DownloadButton } from './DownloadButton';
import { FileDropzone } from './FileDropzone';
import { MapPreview } from './MapPreview';

export type ConverterMode =
  | 'dxf-to-shp'
  | 'dxf-to-geojson'
  | 'shp-to-geojson'
  | 'geojson-to-shp'
  | 'dwg-to-dxf'
  | 'dwg-to-shp'
  | 'dwg-to-geojson'
  | 'kml-to-geojson'
  | 'gpx-to-geojson'
  | 'geojson-to-kml'
  | 'geojson-to-gpkg';

interface ConverterAppProps {
  mode: ConverterMode;
  accept: string;
  hint: string;
}

function modeToFormat(mode: ConverterMode): OutputFormat {
  if (mode.endsWith('-shp')) return 'ESRI Shapefile';
  if (mode.endsWith('-gpkg')) return 'GPKG';
  if (mode.endsWith('-kml')) return 'KML';
  return 'GeoJSON';
}

function usesDwgPipeline(mode: ConverterMode): boolean {
  return mode === 'dwg-to-shp' || mode === 'dwg-to-geojson';
}

function usesLightweightKmlGpx(mode: ConverterMode): boolean {
  return mode === 'kml-to-geojson' || mode === 'gpx-to-geojson';
}

function stageFromProgress(progress: number): ConversionStage {
  if (progress < 20) return 'loading-engine';
  if (progress < 45) return 'reading';
  if (progress < 80) return 'converting';
  if (progress < 100) return 'packaging';
  return 'done';
}

export function ConverterApp({ mode, accept, hint }: ConverterAppProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [stage, setStage] = useState<ConversionStage>('idle');
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [resultName, setResultName] = useState<string>('converted');
  const [previewGeoJSON, setPreviewGeoJSON] = useState<string | null>(null);
  const [report, setReport] = useState<InspectResult | null>(null);

  const outputFormat = useMemo(() => modeToFormat(mode), [mode]);

  const onProgress = (value: number, message?: string) => {
    setProgress(value);
    setStage(stageFromProgress(value));
    if (message) setProgressMessage(message);
  };

  const runConversion = async (inputFiles: File[]) => {
    setFiles(inputFiles);
    setError(null);
    setResultBlob(null);
    setPreviewGeoJSON(null);
    setReport(null);
    setProgress(0);
    setProgressMessage('Starting…');
    setStage('loading-engine');

    try {
      const primary = inputFiles[0];
      if (!primary) throw new Error('No file selected.');

      const gdalOptions = { onProgress, paths: GDAL_PATHS };
      let blob: Blob;
      let fileName = suggestedDownloadName(primary.name, outputFormat);
      let inspection: InspectResult | null = null;
      let inputGeoJsonText: string | undefined;
      let previewTextOverride: string | undefined;
      let previewViaFiles: File[] | undefined;
      const deferMapPreview = mode === 'dwg-to-dxf';

      if (mode === 'dwg-to-dxf') {
        onProgress(40, 'Converting DWG to DXF…');
        const dxfFile = await dwgToDxfFile(primary);
        blob = dxfFile;
        fileName = dxfFile.name;
        onProgress(95, 'DXF ready');
      } else if (usesDwgPipeline(mode)) {
        const dwgResult = await convertDwg(primary, { outputFormat, targetCrs: 'EPSG:4326' }, gdalOptions);
        blob = dwgResult.blob;
        previewViaFiles = [dwgResult.dxfFile];
        fileName = suggestedDownloadName(primary.name.replace(/\.dwg$/i, ''), outputFormat);
        inspection = await inspect([dwgResult.dxfFile], gdalOptions);
      } else if (usesLightweightKmlGpx(mode)) {
        onProgress(40, 'Parsing KML/GPX…');
        blob = await kmlOrGpxFileToGeoJSONBlob(primary);
        fileName = suggestedDownloadName(primary.name, 'GeoJSON');
        const collection = JSON.parse(await blob.text()) as GeoJSON.FeatureCollection;
        inspection = {
          layers: [
            {
              name: 'features',
              geometryType: 'Mixed',
              featureCount: collection.features?.length ?? 0,
            },
          ],
          warnings: [],
        };
        onProgress(95, 'Done');
      } else if (mode === 'geojson-to-kml') {
        inputGeoJsonText = await primary.text();
        const prepared = prepareGeoJsonInput(inputGeoJsonText);
        previewTextOverride = prepared.previewText;
        inspection = {
          layers: [
            {
              name: 'features',
              geometryType: 'Mixed',
              featureCount: prepared.ogrCollection.features.length,
            },
          ],
          warnings: [],
        };
        blob = await geoJSONToKml(prepared.ogrCollection, prepared.sourceCrs);
        onProgress(95, 'Done');
        fileName = suggestedDownloadName(primary.name, 'KML');
      } else if (mode.startsWith('geojson-to-')) {
        inputGeoJsonText = await primary.text();
        const prepared = prepareGeoJsonInput(inputGeoJsonText);
        previewTextOverride = prepared.previewText;
        inspection = await inspect([prepared.ogrFile], gdalOptions);
        blob = await convert(
          [prepared.ogrFile],
          { outputFormat, targetCrs: 'EPSG:4326', sourceCrs: prepared.sourceCrs },
          gdalOptions,
        );
      } else if (mode === 'shp-to-geojson') {
        onProgress(10, 'Reading shapefile…');
        const shpResult = await convertShapefileToGeoJSON(inputFiles, gdalOptions);
        blob = shpResult.blob;
        inspection = shpResult.inspect;
        fileName = suggestedDownloadName(primary.name, 'GeoJSON');
        onProgress(95, 'Done');
      } else {
        inspection = await inspect(inputFiles, gdalOptions);
        blob = await convert(inputFiles, { outputFormat, targetCrs: 'EPSG:4326' }, gdalOptions);
      }

      if (inspection) {
        setReport(inspection);
      }

      setResultBlob(blob);
      setResultName(fileName);

      onProgress(100, 'Conversion complete');
      setStage('done');

      const loadPreview = async () => {
        try {
          if (!deferMapPreview) {
            onProgress(96, 'Rendering map preview…');
          }
          let geojsonText: string;
          const previewOptions = deferMapPreview ? { paths: GDAL_PATHS } : gdalOptions;

          if (previewTextOverride) {
            geojsonText = previewTextOverride;
          } else if (outputFormat === 'GeoJSON') {
            geojsonText = (await blob.text()).trim();
          } else if (inputGeoJsonText) {
            geojsonText = inputGeoJsonText.trim();
          } else {
            geojsonText = (
              await toGeoJSON(previewViaFiles ?? inputFiles, 'EPSG:4326', previewOptions)
            ).trim();
          }

          setPreviewGeoJSON(geojsonText || '{"type":"FeatureCollection","features":[]}');

          if (outputFormat === 'GeoJSON' && inspection) {
            try {
              const collection = JSON.parse(geojsonText) as GeoJSON.FeatureCollection;
              const outputCount = collection.features?.length ?? 0;
              if (outputCount > 0 && inspection.layers.every((layer) => layer.featureCount === 0)) {
                setReport({
                  ...inspection,
                  layers: [
                    {
                      name: inspection.layers[0]?.name ?? 'features',
                      geometryType: inspection.layers[0]?.geometryType ?? 'Mixed',
                      featureCount: outputCount,
                      crs: inspection.layers[0]?.crs,
                    },
                  ],
                  warnings: inspection.warnings,
                });
              }
            } catch {
              // keep inspect report as-is
            }
          }
        } catch {
          // Map preview is optional — conversion result still downloads
        }
      };

      if (deferMapPreview) {
        // DWG→DXF: skip map preview (GDAL WASM ~27 MB, unreliable on slow networks)
      } else {
        await loadPreview();
      }
    } catch (caught) {
      setStage('error');
      setError(caught instanceof Error ? caught.message : 'Conversion failed.');
    }
  };

  return (
    <div className="space-y-6">
      <FileDropzone
        accept={accept}
        hint={hint}
        onFiles={runConversion}
        disabled={
          stage === 'loading-engine' ||
          stage === 'reading' ||
          stage === 'converting' ||
          stage === 'packaging'
        }
      />

      {files.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
          <p className="font-medium text-slate-800">Selected</p>
          <ul className="mt-2 list-disc pl-5">
            {files.map((file) => (
              <li key={`${file.name}-${file.size}`}>{file.name}</li>
            ))}
          </ul>
        </div>
      )}

      <ConversionProgress stage={stage} progress={progress} message={progressMessage} error={error} />

      {report && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-800">Conversion report</h3>
          <div className="mt-3 space-y-2 text-sm text-slate-600">
            {report.layers.map((layer) => (
              <p key={layer.name}>
                {layer.name}: {layer.geometryType} · {layer.featureCount} features
                {layer.crs ? ` · ${layer.crs}` : ''}
              </p>
            ))}
            {report.warnings.map((warning) => (
              <p key={warning} className="text-amber-700">
                {warning}
              </p>
            ))}
          </div>
        </div>
      )}

      {resultBlob && stage === 'done' && (
        <div className="flex flex-wrap items-center gap-3">
          <DownloadButton blob={resultBlob} fileName={resultName} />
          <button
            type="button"
            className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            onClick={() => {
              setFiles([]);
              setStage('idle');
              setProgress(0);
              setProgressMessage(null);
              setResultBlob(null);
              setPreviewGeoJSON(null);
              setReport(null);
            }}
          >
            Convert another file
          </button>
        </div>
      )}

      {stage === 'done' && mode !== 'dwg-to-dxf' && <MapPreview geojsonText={previewGeoJSON} />}
    </div>
  );
}
