import { useEffect, useMemo, useRef } from 'react';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import OSM from 'ol/source/OSM';
import VectorSource from 'ol/source/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import { defaults as defaultControls } from 'ol/control';
import 'ol/ol.css';

interface MapPreviewProps {
  geojsonText: string | null;
  heightClassName?: string;
}

export function MapPreview({ geojsonText, heightClassName = 'h-96' }: MapPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);

  const featureCount = useMemo(() => {
    if (!geojsonText?.trim()) return 0;
    try {
      const data = JSON.parse(geojsonText) as GeoJSON.FeatureCollection;
      return data.features?.length ?? 0;
    } catch {
      return 0;
    }
  }, [geojsonText]);

  useEffect(() => {
    if (!containerRef.current) return;

    if (!mapRef.current) {
      mapRef.current = new Map({
        target: containerRef.current,
        controls: defaultControls(),
        layers: [
          new TileLayer({ source: new OSM() }),
          new VectorLayer({
            source: new VectorSource(),
            style: {
              'stroke-color': '#157a52',
              'stroke-width': 2,
              'fill-color': 'rgba(31, 157, 106, 0.15)',
              'circle-radius': 6,
              'circle-fill-color': '#157a52',
              'circle-stroke-color': '#ffffff',
              'circle-stroke-width': 2,
            },
          }),
        ],
        view: new View({ center: [0, 0], zoom: 2 }),
      });
    }

    const map = mapRef.current;
    const vectorLayer = map.getLayers().item(1) as VectorLayer<VectorSource>;
    const source = vectorLayer.getSource();
    if (!source) return;

    source.clear();

    if (!geojsonText?.trim()) return;

    try {
      const features = new GeoJSON().readFeatures(geojsonText, {
        dataProjection: 'EPSG:4326',
        featureProjection: 'EPSG:3857',
      });
      source.addFeatures(features);
      if (features.length) {
        map.getView().fit(source.getExtent(), { padding: [24, 24, 24, 24], maxZoom: 18 });
      }
    } catch {
      // ignore invalid geojson during intermediate states
    }
  }, [geojsonText]);

  useEffect(() => () => mapRef.current?.setTarget(undefined), []);

  if (geojsonText === null) return null;

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 text-sm font-medium text-slate-700">
        <span>Map preview</span>
        <span className="font-normal text-slate-500">{featureCount} features</span>
      </div>
      {featureCount === 0 ? (
        <div className={`flex items-center justify-center px-4 text-sm text-slate-500 ${heightClassName}`}>
          No features to display on the map. Download the result to inspect the GeoJSON file.
        </div>
      ) : (
        <div ref={containerRef} className={heightClassName} />
      )}
    </div>
  );
}
