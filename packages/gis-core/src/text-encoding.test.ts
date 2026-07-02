import { describe, expect, it } from 'vitest';
import iconv from 'iconv-lite';
import {
  decodeFieldBytes,
  normalizeUnicodeText,
  repairLatin1GbkMojibake,
  transcodeDbfUtf8ToGbk,
} from './text-encoding';

function buildMinimalDbf(fieldValueUtf8: Uint8Array, fieldLength = 20): Uint8Array {
  const headerLength = 65;
  const recordLength = 1 + fieldLength;
  const dbf = new Uint8Array(headerLength + recordLength + 1);
  dbf[0] = 0x03;
  dbf[4] = 1;
  dbf[8] = headerLength;
  dbf[10] = recordLength;

  const name = new TextEncoder().encode('NAME');
  dbf.set(name, 32);
  dbf[43] = 'C'.charCodeAt(0);
  dbf[48] = fieldLength;
  dbf[64] = 0x0d;

  dbf[headerLength] = 0x20;
  dbf.set(fieldValueUtf8.subarray(0, fieldLength), headerLength + 1);
  dbf[headerLength + recordLength] = 0x1a;
  return dbf;
}

describe('text-encoding', () => {
  it('repairs Latin-1 mojibake of GBK village names', () => {
    const garbled = iconv.decode(iconv.encode('北山村', 'gbk'), 'latin1');
    expect(repairLatin1GbkMojibake(garbled)).toBe('北山村');
  });

  it('keeps valid Unicode text unchanged', () => {
    expect(normalizeUnicodeText('北山村JMD')).toBe('北山村JMD');
  });

  it('decodes UTF-8 DBF field bytes', () => {
    const utf8Field = iconv.encode('规划验收', 'utf8');
    expect(decodeFieldBytes(utf8Field)).toBe('规划验收');
  });

  it('transcodes UTF-8 DBF field bytes to GBK', () => {
    const utf8Field = iconv.encode('规划验收', 'utf8');
    const dbf = buildMinimalDbf(utf8Field);
    const transcoded = transcodeDbfUtf8ToGbk(dbf);
    expect(transcoded[29]).toBe(0x57);
    const gbkSlice = transcoded.subarray(66, 66 + 20);
    let end = gbkSlice.length;
    while (end > 0 && (gbkSlice[end - 1] === 0x20 || gbkSlice[end - 1] === 0x00)) end -= 1;
    expect(iconv.decode(gbkSlice.subarray(0, end), 'gbk')).toBe('规划验收');
  });

  it('is idempotent for DBF that is already GBK', () => {
    const utf8Field = iconv.encode('北山村', 'utf8');
    const dbf = buildMinimalDbf(utf8Field);
    const once = transcodeDbfUtf8ToGbk(dbf);
    const twice = transcodeDbfUtf8ToGbk(once);
    expect(Array.from(once)).toEqual(Array.from(twice));
  });
});
