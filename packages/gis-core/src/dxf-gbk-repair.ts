import iconv from 'iconv-lite';

/** DXF group codes that commonly carry human-readable text. */
const DXF_TEXT_GROUP_CODES = new Set([
  1, 2, 3, 6, 7, 8, 9, 100, 102,
  ...Array.from({ length: 51 }, (_, i) => 300 + i),
  ...Array.from({ length: 80 }, (_, i) => 370 + i),
  ...Array.from({ length: 51 }, (_, i) => 1000 + i),
]);

const REPLACEMENT_CHAR = '\uFFFD';
const REPLACEMENT_BYTES = new Uint8Array([0xef, 0xbf, 0xbd]);

export function dxfBytesContainReplacement(dxf: Uint8Array): boolean {
  for (let i = 0; i < dxf.length - 2; i += 1) {
    if (
      dxf[i] === REPLACEMENT_BYTES[0] &&
      dxf[i + 1] === REPLACEMENT_BYTES[1] &&
      dxf[i + 2] === REPLACEMENT_BYTES[2]
    ) {
      return true;
    }
  }
  return false;
}

export function containsReplacementChars(text: string): boolean {
  return text.includes(REPLACEMENT_CHAR);
}

export function scanGeoJsonForReplacementChars(collection: GeoJSON.FeatureCollection): number {
  let hits = 0;
  for (const feature of collection.features ?? []) {
    if (!feature.properties) continue;
    for (const value of Object.values(feature.properties)) {
      if (typeof value === 'string' && containsReplacementChars(value)) {
        hits += 1;
      }
    }
  }
  return hits;
}

function splitDxfLines(bytes: Uint8Array): Uint8Array[] {
  const lines: Uint8Array[] = [];
  let start = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] !== 0x0a) continue;
    let end = i;
    if (end > start && bytes[end - 1] === 0x0d) end -= 1;
    lines.push(bytes.subarray(start, end));
    start = i + 1;
  }
  if (start < bytes.length) lines.push(bytes.subarray(start));
  return lines;
}

function lineEnding(bytes: Uint8Array): Uint8Array {
  return bytes.includes(0x0d) ? new Uint8Array([0x0d, 0x0a]) : new Uint8Array([0x0a]);
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function lineHasHighBytes(bytes: Uint8Array): boolean {
  for (const byte of bytes) {
    if (byte >= 0x80) return true;
  }
  return false;
}

function includesBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0 || haystack.length < needle.length) return false;
  for (let i = 0; i <= haystack.length - needle.length; i += 1) {
    let matched = true;
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

function isValidUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/** Rewrite CP936/GBK string values in a DXF to UTF-8 so GDAL reads Chinese reliably. */
export function repairDxfCp936Strings(dxf: Uint8Array): Uint8Array {
  const lines = splitDxfLines(dxf);
  const eol = lineEnding(dxf);
  const out: Uint8Array[] = [];

  for (let i = 0; i < lines.length; ) {
    const codeLine = lines[i] ?? new Uint8Array();
    const valueLine = lines[i + 1] ?? new Uint8Array();
    i += 2;

    out.push(codeLine, eol);

    const code = Number.parseInt(new TextDecoder('ascii').decode(codeLine).trim(), 10);
    if (Number.isFinite(code) && DXF_TEXT_GROUP_CODES.has(code) && valueLine.length > 0) {
      if (
        lineHasHighBytes(valueLine) &&
        !includesBytes(valueLine, REPLACEMENT_BYTES) &&
        !isValidUtf8(valueLine)
      ) {
        out.push(new TextEncoder().encode(iconv.decode(valueLine, 'gbk')), eol);
        continue;
      }
    }

    out.push(valueLine, eol);
  }

  return concatChunks(out);
}

export const DWG_CHINESE_LOST_ERROR =
  'Chinese text was lost while reading this DWG (LibreDWG cannot preserve GBK labels). Export DXF from AutoCAD/ZWCAD with ANSI_936 (GBK) codepage and upload the .dxf file instead.';

export function assertDxfChineseReadable(dxf: Uint8Array, sourceLabel = 'CAD file'): void {
  if (!dxfBytesContainReplacement(dxf)) return;
  throw new Error(`${DWG_CHINESE_LOST_ERROR} (${sourceLabel})`);
}
