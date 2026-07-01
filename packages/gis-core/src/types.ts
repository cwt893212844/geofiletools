export type OutputFormat =
  | 'ESRI Shapefile'
  | 'GeoJSON'
  | 'KML'
  | 'GPX'
  | 'GPKG';

export interface ConvertOptions {
  outputFormat: OutputFormat;
  sourceCrs?: string;
  targetCrs?: string;
  layerName?: string;
  /** Force output geometry type (-nlt) for shapefile layers. */
  geometryType?: string;
  /** DXF/DWG often mixes geometry types; split into multiple shapefiles. */
  shapefileCompat?: boolean;
}

export interface LayerInfo {
  name: string;
  geometryType: string;
  featureCount: number;
  crs?: string;
}

export interface InspectResult {
  layers: LayerInfo[];
  warnings: string[];
  driver?: string;
}

export interface ConversionReport extends InspectResult {
  outputFormat: OutputFormat;
  outputFileName: string;
}

export type ConversionStage =
  | 'idle'
  | 'loading-engine'
  | 'reading'
  | 'converting'
  | 'packaging'
  | 'done'
  | 'error';

export type ProgressReporter = (progress: number, message?: string) => void;

export interface GdalOperationOptions {
  onProgress?: ProgressReporter;
  paths?: GdalPaths;
}

export const MAX_FILE_SIZE_BYTES = 30 * 1024 * 1024;

export interface GdalPaths {
  wasm: string;
  data: string;
  js: string;
}

export const DEFAULT_GDAL_PATHS: GdalPaths = {
  js: '/gdal/gdal3.js',
  wasm: '/gdal/gdal3WebAssembly.wasm',
  data: '/gdal/gdal3WebAssembly.data',
};
