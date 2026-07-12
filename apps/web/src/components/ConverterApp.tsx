import { useMemo, useRef, useState } from 'react';
import type { ConversionStage } from '../lib/conversion-stage';
import { loadGisCore } from '../lib/gis-core-client';
import { GDAL_PATHS } from '../lib/gdal-paths';
import { ConversionProgress } from './ConversionProgress';
import { DownloadButton } from './DownloadButton';
import { FileDropzone } from './FileDropzone';
import { MapPreview } from './MapPreview';

import type { ConvertOptions, InspectResult, OutputFormat } from '@gis-tools/core';

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

function usesCadInput(mode: ConverterMode): boolean {
  return mode.startsWith('dxf-') || usesDwgPipeline(mode);
}

function gdalConvertOptions(mode: ConverterMode, outputFormat: OutputFormat): ConvertOptions {
  const options: ConvertOptions = { outputFormat };
  if (!usesCadInput(mode)) {
    options.targetCrs = 'EPSG:4326';
  }
  if (outputFormat === 'ESRI Shapefile') {
    options.shapefileCompat = true;
  }
  return options;
}

function formatConversionError(caught: unknown): string {
  if (caught instanceof Error && caught.message) return caught.message;
  if (typeof caught === 'string' && caught.trim()) return caught.trim();
  if (Array.isArray(caught)) {
    const text = caught.map((item) => String(item)).join('; ').trim();
    if (text) return text;
  }
  return 'Conversion failed.';
}

const MAP_PREVIEW_MAX_FEATURES = 8_000;
const MAP_PREVIEW_MAX_BYTES = 8 * 1024 * 1024;

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
  const conversionDoneRef = useRef(false);

  const outputFormat = useMemo(() => modeToFormat(mode), [mode]);

  const onProgress = (value: number, message?: string) => {
    if (conversionDoneRef.current) return;
    setProgress(value);
    setStage(stageFromProgress(value));
    if (message) setProgressMessage(message);
  };

  const runConversion = async (inputFiles: File[]) => {
    conversionDoneRef.current = false;
    setFiles(inputFiles);
    setError(null);
    setResultBlob(null);
    setPreviewGeoJSON(null);
    setReport(null);
    setProgress(0);
    setProgressMessage('Loading converter…');
    setStage('loading-engine');

    try {
      const gis = await loadGisCore();
      const {
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
      } = gis;

      setProgressMessage('Starting…');

      const primary = inputFiles[0];
      if (!primary) throw new Error('No file selected.');

      const conversionWarnings: string[] = [];
      const gdalOptions = {
        onProgress,
        onWarning: (msg: string) => conversionWarnings.push(msg),
        paths: GDAL_PATHS,
      };
      let blob: Blob;
      let fileName = suggestedDownloadName(primary.name, outputFormat);
      let inspection: InspectResult | null = null;
      let inputGeoJsonText: string | undefined;
      let previewTextOverride: string | undefined;
      let previewViaFiles: File[] | undefined;
      const deferMapPreview = mode === 'dwg-to-dxf' || (usesCadInput(mode) && outputFormat === 'ESRI Shapefile');

      if (mode === 'dwg-to-dxf') {
        onProgress(40, 'Converting DWG to DXF…');
        const dxfFile = await dwgToDxfFile(primary, gdalOptions);
        blob = dxfFile;
        fileName = dxfFile.name;
        onProgress(95, 'DXF ready');
      } else if (usesDwgPipeline(mode)) {
        const dwgResult = await convertDwg(primary, gdalConvertOptions(mode, outputFormat), gdalOptions);
        blob = dwgResult.blob;
        previewViaFiles = [dwgResult.dxfFile];
        fileName = suggestedDownloadName(primary.name.replace(/\.dwg$/i, ''), outputFormat);
        inspection = await inspect([dwgResult.dxfFile], gdalOptions);

        // Show detected CRS from DWG in the report
        if (dwgResult.detectedCrs && inspection) {
          inspection = {
            ...inspection,
            layers: inspection.layers.map((l) => ({ ...l, crs: dwgResult.detectedCrs })),
          };
        } else if (inspection && outputFormat === 'ESRI Shapefile') {
          inspection = {
            ...inspection,
            warnings: [
              ...inspection.warnings,
              'Drawing has no coordinate system; output keeps original CAD coordinates. Assign CRS in QGIS if locations look wrong.',
            ],
          };
        }
      } else if (usesLightweightKmlGpx(mode)) {
        onProgress(40, 'Parsing KML/GPX…');
        blob = await kmlOrGpxFileToGeoJSONBlob(primary);
        fileName = suggestedDownloadName(primary.name, 'GeoJSON');
        const collection = JSON.parse(await blob.text()) as GeoJSON.FeatureCollection;

        const kmlWarnings: string[] = [];
        const sampleCoords = collection.features
          .slice(0, 50)
          .flatMap((f) => {
            const g = f.geometry;
            if (!g) return [];
            if (g.type === 'Point') return [g.coordinates as number[]];
            if (g.type === 'LineString') return (g.coordinates as number[][]).slice(0, 1);
            if (g.type === 'Polygon') return ((g.coordinates as number[][][])[0] ?? []).slice(0, 1);
            return [];
          });
        const hasNonWgs84 = sampleCoords.some(
          (c) => typeof c[1] === 'number' && (c[1] > 90 || c[1] < -90),
        );
        if (hasNonWgs84) {
          kmlWarnings.push(
            'Coordinates appear to be in a local/projected CRS (not WGS84). Map preview shows geometry shape only — open the GeoJSON in QGIS and assign the correct CRS for proper georeferencing.',
          );
        }

        inspection = {
          layers: [
            {
              name: 'features',
              geometryType: 'Mixed',
              featureCount: collection.features?.length ?? 0,
            },
          ],
          warnings: kmlWarnings,
        };
        onProgress(95, 'Done');
      } else if (mode === 'geojson-to-kml') {
        inputGeoJsonText = await primary.text();
        const prepared = prepareGeoJsonInput(inputGeoJsonText);
        previewTextOverride = prepared.previewText;
        conversionWarnings.push(...prepared.warnings);
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
        // Derive layer info from the parsed collection — avoids an extra GDAL open/close
        // cycle that can leave stale dataset handles and cause a NULL hDS on the convert call.
        const geomTypes = new Set(
          prepared.ogrCollection.features
            .map((f) => f.geometry?.type)
            .filter((t): t is string => !!t),
        );

        const convertOpts = gdalConvertOptions(mode, outputFormat);
        conversionWarnings.push(...prepared.warnings);

        if (prepared.sourceCrs) {
          // Projected coordinates (e.g. CGCS2000, UTM): don't reproject to WGS84 —
          // just assign the detected CRS to the output so GIS software can locate the data.
          delete convertOpts.targetCrs;
          convertOpts.assignCrs = prepared.sourceCrs;
          const outName = outputFormat === 'ESRI Shapefile' ? 'Shapefile' : outputFormat;
          conversionWarnings.push(
            `Detected CRS ${prepared.sourceCrs} from coordinates. Output ${outName} will include this CRS.`,
          );
        }

        inspection = {
          layers: [
            {
              name: 'features',
              geometryType: geomTypes.size === 1 ? [...geomTypes][0]! : 'Mixed',
              featureCount: prepared.ogrCollection.features.length,
              crs: prepared.sourceCrs,
            },
          ],
          warnings: [],
        };
        blob = await convert(
          [prepared.ogrFile],
          convertOpts,
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

        // Detect CRS from CAD files and assign it to the SHP output (.prj).
        let detectedCrs: string | undefined;
        if (usesCadInput(mode)) {
          const { detectCadCrs } = gis;
          detectedCrs = await detectCadCrs(primary, gdalOptions);
        }

        if (usesCadInput(mode) && !inspection.layers.some((layer) => layer.crs) && !detectedCrs) {
          inspection = {
            ...inspection,
            warnings: [
              ...inspection.warnings,
              'Drawing has no coordinate system; output keeps original CAD coordinates. Assign CRS in QGIS if locations look wrong.',
            ],
          };
        }
        if (usesCadInput(mode) && outputFormat === 'ESRI Shapefile') {
          inspection = {
            ...inspection,
            warnings: [
              ...inspection.warnings,
              'CAD drawings mix geometry types; Shapefile ZIP contains separate point/line/polygon layers where present.',
              'Attribute table uses GBK encoding (.cpg) for Chinese text in QGIS/ArcGIS.',
            ],
          };
        }

        const convertOpts = gdalConvertOptions(mode, outputFormat);
        if (detectedCrs && !convertOpts.sourceCrs && !convertOpts.targetCrs) {
          convertOpts.assignCrs = detectedCrs;
          if (inspection) {
            inspection = {
              ...inspection,
              layers: inspection.layers.map((l) => ({ ...l, crs: detectedCrs })),
            };
          }
        }

        blob = await convert(inputFiles, convertOpts, gdalOptions);
      }

      if (conversionWarnings.length > 0) {
        inspection = {
          layers: inspection?.layers ?? [],
          warnings: [...(inspection?.warnings ?? []), ...conversionWarnings],
          driver: inspection?.driver,
        };
      }
      if (inspection) {
        setReport(inspection);
      }

      setResultBlob(blob);
      setResultName(fileName);

      onProgress(100, 'Conversion complete');
      setStage('done');
      conversionDoneRef.current = true;

      const loadPreview = async () => {
        try {
          let geojsonText: string;
          const previewOptions = { paths: GDAL_PATHS };

          if (previewTextOverride) {
            geojsonText = previewTextOverride;
          } else if (outputFormat === 'GeoJSON') {
            geojsonText = (await blob.text()).trim();
          } else if (inputGeoJsonText) {
            geojsonText = inputGeoJsonText.trim();
          } else {
            geojsonText = (
              await toGeoJSON(
                previewViaFiles ?? inputFiles,
                usesCadInput(mode) ? undefined : 'EPSG:4326',
                previewOptions,
              )
            ).trim();
          }

          const skipLargePreview =
            blob.size > MAP_PREVIEW_MAX_BYTES ||
            (() => {
              try {
                const collection = JSON.parse(geojsonText) as GeoJSON.FeatureCollection;
                return (collection.features?.length ?? 0) > MAP_PREVIEW_MAX_FEATURES;
              } catch {
                return false;
              }
            })();

          if (skipLargePreview) {
            setReport((prev) =>
              prev
                ? {
                    ...prev,
                    warnings: [
                      ...prev.warnings,
                      'Map preview skipped for large output; download the file to inspect in QGIS.',
                    ],
                  }
                : prev,
            );
            return;
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

      if (!deferMapPreview) {
        void loadPreview();
      }
    } catch (caught) {
      setStage('error');
      setProgressMessage(null);
      setError(formatConversionError(caught));
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
