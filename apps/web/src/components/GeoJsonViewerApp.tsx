import { useState } from 'react';
import { convertShapefileToGeoJSON, inspect, isShapefileUpload, toGeoJSON } from '@gis-tools/core';
import { GDAL_PATHS } from '../lib/gdal-paths';
import { ConversionProgress } from './ConversionProgress';
import { FileDropzone } from './FileDropzone';
import { MapPreview } from './MapPreview';

export function GeoJsonViewerApp() {
  const [geojsonText, setGeojsonText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<string | null>(null);
  const [stage, setStage] = useState<'idle' | 'loading-engine' | 'reading' | 'converting' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);

  const handleFiles = async (files: File[]) => {
    setError(null);
    setMeta(null);
    setProgress(0);
    setStage('loading-engine');

    const onProgress = (value: number, message?: string) => {
      setProgress(value);
      if (message) setProgressMessage(message);
      if (value < 45) setStage('reading');
      else if (value < 95) setStage('converting');
      else setStage('done');
    };

    try {
      const primary = files[0];
      if (!primary) return;

      if (primary.name.toLowerCase().endsWith('.geojson') || primary.name.toLowerCase().endsWith('.json')) {
        onProgress(50, 'Reading GeoJSON…');
        const text = await primary.text();
        JSON.parse(text);
        setGeojsonText(text);
        setMeta('GeoJSON loaded locally');
        onProgress(100, 'Ready');
        setStage('done');
        return;
      }

      const gdalOptions = { onProgress, paths: GDAL_PATHS };

      if (isShapefileUpload(files)) {
        onProgress(20, 'Reading shapefile…');
        const result = await convertShapefileToGeoJSON(files, gdalOptions);
        const text = await result.blob.text();
        setGeojsonText(text);
        setMeta(
          result.inspect.layers.map((layer) => `${layer.name}: ${layer.featureCount} features`).join(' · ') ||
            'Shapefile loaded',
        );
        onProgress(100, 'Ready');
        setStage('done');
        return;
      }

      const report = await inspect(files, gdalOptions);
      const text = await toGeoJSON(files, 'EPSG:4326', gdalOptions);
      setGeojsonText(text);
      setMeta(
        report.layers.map((layer) => `${layer.name}: ${layer.featureCount} features`).join(' · ') ||
          'Vector dataset loaded',
      );
      onProgress(100, 'Ready');
      setStage('done');
    } catch (caught) {
      setGeojsonText(null);
      setStage('error');
      setError(caught instanceof Error ? caught.message : 'Failed to load file.');
    }
  };

  return (
    <div className="space-y-6">
      <FileDropzone
        accept=".geojson,.json,.zip,.shp,.dbf,.shx,.prj,.cpg,.dxf"
        hint="GeoJSON, Shapefile sidecars, zipped shapefile, or DXF"
        onFiles={handleFiles}
        disabled={stage === 'loading-engine' || stage === 'reading' || stage === 'converting'}
      />
      <ConversionProgress stage={stage} progress={progress} message={progressMessage} error={error} />
      {meta && stage === 'done' && <p className="text-sm text-slate-600">{meta}</p>}
      <MapPreview geojsonText={geojsonText} heightClassName="h-[32rem]" />
    </div>
  );
}
