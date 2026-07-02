import iconv from 'iconv-lite';

const CJK_RE = /[\u3400-\u9fff]/;
/** dBASE VII language driver ID for Simplified Chinese (CP936 / GBK). */
const DBF_LDID_CP936 = 0x57;

export const SHAPEFILE_CPG_GBK = 'GBK';

export function hasCjk(text: string): boolean {
  return CJK_RE.test(text);
}

/** GDAL/DBF sometimes expose GBK bytes as Latin-1 strings — recover Chinese when possible. */
export function repairLatin1GbkMojibake(text: string): string {
  if (!text || hasCjk(text)) return text;
  const bytes = Uint8Array.from(text, (char) => char.charCodeAt(0) & 0xff);
  if (!bytes.length) return text;
  try {
    const repaired = iconv.decode(bytes, 'gbk');
    return hasCjk(repaired) ? repaired : text;
  } catch {
    return text;
  }
}

export function normalizeUnicodeText(text: string): string {
  return repairLatin1GbkMojibake(text.trim());
}

export function normalizeGeoJsonTextProperties(
  collection: GeoJSON.FeatureCollection,
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: collection.features.map((feature) => ({
      ...feature,
      properties: feature.properties
        ? Object.fromEntries(
            Object.entries(feature.properties).map(([key, value]) => {
              if (typeof value === 'string') return [key, normalizeUnicodeText(value)];
              return [key, value];
            }),
          )
        : feature.properties,
    })),
  };
}

export function encodeGbk(text: string): Uint8Array {
  return Uint8Array.from(iconv.encode(normalizeUnicodeText(text), 'gbk'));
}

function isValidUtf8(bytes: Uint8Array): boolean {
  try {
    const decoded = new TextDecoder('utf8', { fatal: true }).decode(bytes);
    return !decoded.includes('\uFFFD');
  } catch {
    return false;
  }
}

export function decodeFieldBytes(bytes: Uint8Array): string {
  const trimmed = trimTrailingSpaces(bytes);
  if (!trimmed.length) return '';

  if (isValidUtf8(trimmed)) {
    const utf8 = iconv.decode(trimmed, 'utf8');
    if (hasCjk(utf8)) return normalizeUnicodeText(utf8);
    if (utf8 && /^[\x20-\x7e]+$/.test(utf8)) return utf8;
  }

  try {
    const gbk = iconv.decode(trimmed, 'gbk');
    if (hasCjk(gbk)) return gbk;
    if (gbk && /^[\x20-\x7e]+$/.test(gbk)) return gbk;
  } catch {
    // fall through
  }

  return normalizeUnicodeText(iconv.decode(trimmed, 'utf8'));
}

function trimTrailingSpaces(bytes: Uint8Array): Uint8Array {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0x20) end -= 1;
  return bytes.subarray(0, end);
}

function fillSpaces(target: Uint8Array, offset: number, count: number): void {
  for (let i = 0; i < count; i += 1) target[offset + i] = 0x20;
}

interface DbfField {
  name: string;
  type: string;
  length: number;
  start: number;
}

function parseDbfFields(dbf: Uint8Array): {
  fields: DbfField[];
  headerLength: number;
  recordLength: number;
  recordCount: number;
} {
  const view = new DataView(dbf.buffer, dbf.byteOffset, dbf.byteLength);
  const headerLength = view.getUint16(8, true);
  const recordLength = view.getUint16(10, true);
  const recordCount = view.getUint32(4, true);
  const fields: DbfField[] = [];
  let start = 1;

  for (let off = 32; off < headerLength - 1; off += 32) {
    if (dbf[off] === 0x0d) break;
    const name = new TextDecoder('ascii').decode(dbf.slice(off, off + 11)).replace(/\0/g, '');
    const type = String.fromCharCode(dbf[off + 11]);
    const length = dbf[off + 16];
    fields.push({ name, type, length, start });
    start += length;
  }

  return { fields, headerLength, recordLength, recordCount };
}

function fieldBytesAlreadyGbk(slice: Uint8Array, text: string): boolean {
  if (!text || !hasCjk(text)) return false;
  const encoded = encodeGbk(text);
  const trimmed = trimTrailingSpaces(slice);
  if (encoded.length !== trimmed.length) return false;
  for (let i = 0; i < encoded.length; i += 1) {
    if (encoded[i] !== trimmed[i]) return false;
  }
  return true;
}

/** GDAL WASM writes UTF-8 DBF; Chinese QGIS/ArcGIS expect GBK bytes + GBK/CP936 .cpg. */
export function transcodeDbfUtf8ToGbk(dbf: Uint8Array): Uint8Array {
  const out = new Uint8Array(dbf);
  const { fields, headerLength, recordLength, recordCount } = parseDbfFields(dbf);

  for (let record = 0; record < recordCount; record += 1) {
    const recordOffset = headerLength + record * recordLength;
    for (const field of fields) {
      if (field.type !== 'C' || field.length === 0) continue;
      const slice = dbf.subarray(
        recordOffset + field.start,
        recordOffset + field.start + field.length,
      );
      const text = decodeFieldBytes(slice);
      if (!text || fieldBytesAlreadyGbk(slice, text)) continue;

      const gbk = encodeGbk(text);
      const writeLength = Math.min(gbk.length, field.length);
      out.set(gbk.subarray(0, writeLength), recordOffset + field.start);
      if (writeLength < field.length) {
        fillSpaces(out, recordOffset + field.start + writeLength, field.length - writeLength);
      }
    }
  }

  out[29] = DBF_LDID_CP936;
  return out;
}

export function shapefileCpgForEncoding(encoding: 'UTF-8' | 'CP936'): string {
  return encoding === 'CP936' ? SHAPEFILE_CPG_GBK : 'UTF-8';
}
