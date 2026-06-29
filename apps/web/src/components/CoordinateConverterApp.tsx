import { useState } from 'react';
import { COMMON_CRS, transformCoordinates, utmToWgs84, wgs84ToUtm } from '@gis-tools/core';

function formatCoordinatePair(x: number, y: number, decimals = 6): string {
  return `${x.toFixed(decimals)}, ${y.toFixed(decimals)}`;
}

export function CoordinateConverterApp() {
  const [fromCrs, setFromCrs] = useState('EPSG:4326');
  const [toCrs, setToCrs] = useState('EPSG:32633');
  const [x, setX] = useState('12.4924');
  const [y, setY] = useState('41.8902');
  const [utmZone, setUtmZone] = useState('33');
  const [northern, setNorthern] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  let result: ReturnType<typeof transformCoordinates> | null = null;
  try {
    const parsedX = Number(x);
    const parsedY = Number(y);
    if (Number.isFinite(parsedX) && Number.isFinite(parsedY)) {
      if (fromCrs === 'EPSG:4326' && (toCrs.startsWith('EPSG:326') || toCrs.startsWith('EPSG:327'))) {
        result = wgs84ToUtm(parsedY, parsedX);
      } else if (
        (fromCrs.startsWith('EPSG:326') || fromCrs.startsWith('EPSG:327')) &&
        toCrs === 'EPSG:4326'
      ) {
        result = utmToWgs84(parsedX, parsedY, Number(utmZone), northern);
      } else {
        result = transformCoordinates({ x: parsedX, y: parsedY }, fromCrs, toCrs);
      }
    }
  } catch (caught) {
    if (!error) {
      setError(caught instanceof Error ? caught.message : 'Conversion failed');
    }
  }

  const copyResult = async () => {
    if (!result) return;
    const text = formatCoordinatePair(result.to.coordinates.x, result.to.coordinates.y);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
        <div>
          <label className="text-sm font-medium text-slate-700">From CRS</label>
          <select
            className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"
            value={fromCrs}
            onChange={(event) => {
              setError(null);
              setFromCrs(event.target.value);
            }}
          >
            {COMMON_CRS.map((crs) => (
              <option key={crs.code} value={crs.code}>
                {crs.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm font-medium text-slate-700">To CRS</label>
          <select
            className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"
            value={toCrs}
            onChange={(event) => {
              setError(null);
              setToCrs(event.target.value);
            }}
          >
            {COMMON_CRS.map((crs) => (
              <option key={`to-${crs.code}`} value={crs.code}>
                {crs.label}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium text-slate-700">X / Lon / Easting</label>
            <input
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"
              value={x}
              onChange={(event) => {
                setError(null);
                setX(event.target.value);
              }}
            />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700">Y / Lat / Northing</label>
            <input
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"
              value={y}
              onChange={(event) => {
                setError(null);
                setY(event.target.value);
              }}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium text-slate-700">UTM zone</label>
            <input
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"
              value={utmZone}
              onChange={(event) => setUtmZone(event.target.value)}
            />
          </div>
          <label className="mt-7 flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={northern} onChange={(event) => setNorthern(event.target.checked)} />
            Northern hemisphere
          </label>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-slate-800">Result</h3>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        {result && (
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-slate-500">Input ({result.from.crs})</dt>
              <dd className="font-mono text-slate-800">
                {result.from.coordinates.x.toFixed(6)}, {result.from.coordinates.y.toFixed(6)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Output ({result.to.crs})</dt>
              <dd className="mt-1 flex flex-wrap items-center gap-3">
                <span className="font-mono text-slate-800">
                  {formatCoordinatePair(result.to.coordinates.x, result.to.coordinates.y)}
                </span>
                <button
                  type="button"
                  onClick={copyResult}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </dd>
            </div>
          </dl>
        )}
      </div>
    </div>
  );
}
