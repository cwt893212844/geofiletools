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

/**
 * When bytes are valid UTF-8 but codepage says GBK, determine whether the text is
 * genuine UTF-8 (浩辰 CAD) or native GBK bytes that accidentally form valid UTF-8
 * (e.g. 杨=D1EE → UTF-8 U+046E Ѯ).
 *
 * GBK 2-byte sequences that pass isValidUtf8 always decode to U+0080-U+07FF in UTF-8
 * (Latin Extended / Greek / Cyrillic — never CJK).  Genuine Chinese UTF-8 decodes to
 * CJK characters (U+2E80+).  So: if UTF-8 decode contains chars ≥ U+0800, it's real UTF-8.
 */
function utf8DecodeHasHighCodepoints(bytes: Uint8Array): boolean {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) >= 0x0800) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Rewrite CP936/GBK string values in a DXF to UTF-8 so GDAL reads Chinese reliably.
 *
 * Always rewrites $DWGCODEPAGE ANSI_936 → UTF-8 so GDAL does not re-decode the content
 * as GBK.  This covers three cases:
 *   1. Native GBK DXF: raw GBK bytes are converted to UTF-8 (madeRepairs = true).
 *   2. 浩辰/cadence UTF-8 DXF: file is already valid UTF-8 but header still says ANSI_936;
 *      without patching the header GDAL double-decodes UTF-8→GBK→mojibake.
 *   3. Native GBK where some byte pairs accidentally form valid UTF-8 2-byte sequences
 *      (e.g. 杨=D1EE → valid UTF-8 U+046E).  Detected by checking that UTF-8 decode
 *      contains only codepoints < U+0800 (GBK→UTF-8 2-byte maps to Latin/Greek/Cyrillic
 *      range, never CJK); genuine UTF-8 Chinese has codepoints ≥ U+0800.
 */
export function repairDxfCp936Strings(dxf: Uint8Array): Uint8Array {
  const lines = splitDxfLines(dxf);
  const eol = lineEnding(dxf);
  const out: Uint8Array[] = [];

  let awaitingCodepageValue = false;
  let codepageValueIdx = -1; // index in out[] where the codepage value chunk lives
  let codepageDeclaresGbk = false;

  const ascii = (bytes: Uint8Array) =>
    new TextDecoder('ascii', { fatal: false }).decode(bytes).trim();

  for (let i = 0; i < lines.length; ) {
    const codeLine = lines[i] ?? new Uint8Array();
    const valueLine = lines[i + 1] ?? new Uint8Array();
    i += 2;

    out.push(codeLine, eol);

    const code = Number.parseInt(ascii(codeLine), 10);

    // Detect the $DWGCODEPAGE header variable (group code 9 = header var name)
    if (code === 9 && ascii(valueLine) === '$DWGCODEPAGE') {
      awaitingCodepageValue = true;
      out.push(valueLine, eol);
      continue;
    }

    // The pair immediately following $DWGCODEPAGE is group code 3 = codepage string
    if (awaitingCodepageValue) {
      awaitingCodepageValue = false;
      if (code === 3 && /ANSI_936|GB2312|GBK/i.test(ascii(valueLine))) {
        // Record position — we will overwrite this value with UTF-8 at the end,
        // regardless of whether raw GBK bytes were found (covers 浩辰CAD UTF-8+ANSI_936).
        codepageValueIdx = out.length;
        codepageDeclaresGbk = true;
      }
      // Fall through: value is pushed by the normal path below
    }

    if (Number.isFinite(code) && DXF_TEXT_GROUP_CODES.has(code) && valueLine.length > 0) {
      if (
        lineHasHighBytes(valueLine) &&
        !includesBytes(valueLine, REPLACEMENT_BYTES)
      ) {
        if (!isValidUtf8(valueLine)) {
          // Definitely not valid UTF-8 → treat as GBK
          out.push(new TextEncoder().encode(iconv.decode(valueLine, 'gbk')), eol);
          continue;
        }
        // Bytes happen to be valid UTF-8, but codepage header says GBK.
        // Many Chinese GBK byte pairs (e.g. 杨=D1EE) accidentally pass isValidUtf8
        // because they form valid UTF-8 2-byte sequences mapping to U+0080-U+07FF
        // (Latin/Greek/Cyrillic — never CJK).  Genuine UTF-8 Chinese (浩辰 CAD)
        // decodes to codepoints ≥ U+0800 (CJK range).
        if (codepageDeclaresGbk && !utf8DecodeHasHighCodepoints(valueLine)) {
          // GBK bytes masquerading as UTF-8 → convert to real UTF-8
          out.push(new TextEncoder().encode(iconv.decode(valueLine, 'gbk')), eol);
          continue;
        }
      }
    }

    out.push(valueLine, eol);
  }

  // Always set codepage to UTF-8 when header claims ANSI_936.
  // After this function the output bytes are always UTF-8; telling GDAL otherwise
  // would trigger a second GBK→UTF-8 decode that corrupts every character.
  if (codepageValueIdx >= 0) {
    out[codepageValueIdx] = new TextEncoder().encode('UTF-8');
  }

  return concatChunks(out);
}

export const DWG_CHINESE_LOST_WARNING =
  'Chinese text labels were lost while reading this DWG (LibreDWG/cadview cannot preserve GBK). Geometry is still exported, but text fields may be empty. For correct text, export DXF from AutoCAD/ZWCAD using ANSI_936 (GBK) codepage.';

/** @deprecated Use DWG_CHINESE_LOST_WARNING with onWarning instead of throwing. */
export const DWG_CHINESE_LOST_ERROR = DWG_CHINESE_LOST_WARNING;

export function warnIfDxfChineseLost(
  dxf: Uint8Array,
  operationOptions?: { onWarning?: (message: string) => void },
): boolean {
  if (!dxfBytesContainReplacement(dxf)) return false;
  operationOptions?.onWarning?.(DWG_CHINESE_LOST_WARNING);
  return true;
}

export function assertDxfChineseReadable(dxf: Uint8Array, sourceLabel = 'CAD file'): void {
  if (!dxfBytesContainReplacement(dxf)) return;
  throw new Error(`${DWG_CHINESE_LOST_WARNING} (${sourceLabel})`);
}
